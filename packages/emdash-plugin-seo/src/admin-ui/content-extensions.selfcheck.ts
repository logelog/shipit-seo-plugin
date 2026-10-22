import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as previewIcons from "@phosphor-icons/react";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
	analyzeSeoContent, seoAnalysisPresentation, seoAnalysisSummary, seoScoreDisplay, seoScoreLimitText, summarizeSeoChecks, type SeoAnalysisInput,
} from "../analysis.ts";
import { SEO_EARLIER_ANALYZER_LABEL, seoCheckTotalsText, type SeoCheckRow } from "../check-presentation.ts";
import { SeoBrandProvider, useSeoBrand } from "./brand-context.ts";
import {
	buildSavedSearchPreviewModel, resolveCheckFixTarget, SEO_CHECK_BASIS_LABELS, SEO_OWNERSHIP_SOURCE_LABELS,
	contentCheckPresentation, keywordCheckCoverage,
	analysisPresentation, hasCurrentEditorAnalysis, selectEditorScore,
	searchExclusionCheck, resolveSeoDraftIndexability, validateSeoCanonicalDraft, localeGraphDiagnosticLabel, editorScoreStateCopy, editorManualAnalysisState,
	type SeoContentCheck, type SeoContentCheckGroup,
} from "./content-extension-model.ts";
import {
	beginSocialRecovery, beginSocialSave, canCloseSocialSave, canSaveSocialValues,
	closeSocialSave, createSocialSaveState, reviewSocialSaveValues, socialSaveReducer,
} from "./social-save-state.ts";
import {
	SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, SEO_ENGINE_VERSION, SEO_SCORE_VERSION,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT, SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH, SEO_ADMIN_OUTPUT_SUPPORT, SEO_ADMIN_OWNERSHIP_FIELDS, seoKeywordIdentity,
	type SeoAdminEntryPreview, type SeoAdminEntrySchemaGraph,
	type SeoAdminSocialOverrideReadResult, type SeoAdminSocialOverrideSnapshot,
} from "../admin-contract.ts";
import {
	ENTRY_SCHEMA_SOURCE_LABELS, createEntrySchemaPanelStore, entrySchemaConfirmationDetached, entrySchemaInUseRows, entrySchemaOutputState,
	entrySchemaRemovalRequest,
} from "./entry-schema-model.ts";
import { resolveEditorBasicAnalysis } from "./editor-basic-analysis.ts";
import { createSavedContentSnapshot, savedSnapshotMatches } from "./saved-content-snapshot.ts";
import { contentScoreColumnPresentation } from "./content-score-column.ts";
import { extractSeoDocumentText } from "../document-signals.ts";
import { seoKeywordMatchRanges } from "../keyword-match.ts";
import * as snippetFitModule from "../snippet-fit.ts";
import { contentBodyValue } from "../content-analysis-inputs.ts";
import { normaliseKeywordChip } from "./keyword-profile.ts";
import * as keywordProfileModule from "./keyword-profile.ts";
import { socialSaveNoticeMessage } from "./social-save-copy.ts";
import * as nativeSeoState from "./native-seo-editor-state.ts";
import { buildNativeSeoSearchPreview } from "./native-seo-editor-preview.ts";
import { selectedLocalMediaUrl } from "./local-media.ts";
import * as nativeSeoImageFallback from "./native-seo-image-fallback.ts";
import type { NativeSeoEditorController } from "./native-seo-editor-fields.tsx";
import { createSocialEditorStore, type SocialOverrideDraftState } from "./social-editor-store.ts";

const source = await readFile(new URL("./content-extensions.tsx", import.meta.url), "utf8");
const savedPanelSource = source.slice(source.indexOf("function SavedSeoEditorPanel("));
const registrationSource = await readFile(
	new URL("./content-extension-registration.ts", import.meta.url),
	"utf8",
);
const sessionSource = await readFile(
	new URL("./content-extension-session.ts", import.meta.url),
	"utf8",
);
const contentScoreColumnSource = await readFile(
	new URL("./content-score-column.ts", import.meta.url),
	"utf8",
);
const apiSource = await readFile(new URL("./api.ts", import.meta.url), "utf8");
const css = await readFile(new URL("./admin.css", import.meta.url), "utf8");
const metadataReviewSource = await readFile(new URL("./saved-metadata-review.tsx", import.meta.url), "utf8");
const nativeSeoFieldsSource = await readFile(new URL("./native-seo-editor-fields.tsx", import.meta.url), "utf8");
const previewRendererSource = await readFile(new URL("./search-social-preview.tsx", import.meta.url), "utf8");
const editorCss = await readFile(new URL("./content-editor.css", import.meta.url), "utf8");
const adminSource = await readFile(new URL("./admin.tsx", import.meta.url), "utf8");
const workQueueSource = await readFile(
	new URL("./work-queue-view.tsx", import.meta.url),
	"utf8",
);
const scoringControlsSource = await readFile(
	new URL("./content-scoring-controls.tsx", import.meta.url),
	"utf8",
);

// Native writes stay in the guarded controller; the preview never bridges the host draft or edits URLs.
assert.doesNotMatch(source, /MediaPickerModal|previewUrlWithSlug|measureSnippetTextPx|renderedTextFits/);
assert.doesNotMatch(source, /onLivePreviewChange|applyDraftToHost|executeSeoSnippetApplyPlan/);

// --- Work Queue module state ----------------------------------------------
assert.match(workQueueSource, /queryKey:\s*seoWorkspaceKeys\.configuration/);
assert.match(workQueueSource, /enabled:\s*scope === "images"/);
assert.match(workQueueSource, /enabled:\s*canLoadScores/);
assert.match(
	workQueueSource,
	/buildSeoWorkQueue\(currentScores, scope, imageAvailability\)/,
);
assert.match(workQueueSource, /seoWorkQueueScoreCoverage\(sessionMode \? sessionScores : scores\?\.items \?\? \[\]\)/);
assert.match(workQueueSource, /scoreCoverage\.state === "mixed"/);
assert.match(workQueueSource, /Some content is omitted because its stored analysis is out of date\./);
assert.match(workQueueSource, /imageAvailability === "unavailable"/);
assert.doesNotMatch(
	workQueueSource,
	/\{scores \? \(/,
	"module status and scope controls must render without a score response",
);
assert.match(
	adminSource,
	/removeQueries\(\{\s*queryKey:\s*seoWorkspaceKeys\.workQueue,\s*\}\)/,
);
const workspaceSource = adminSource.slice(adminSource.indexOf("function SeoAdminWorkspace()"));
assert.doesNotMatch(workspaceSource, /useContentOptionsQuery\(\)/);
assert.match(scoringControlsSource, /fetchSeoAuditContentOptions\(\{ signal \}\)/);
assert.match(workspaceSource, /useOverviewQuery\(false\)/);
assert.doesNotMatch(
	adminSource,
	/ReadinessStrip|READINESS_STRIP_VIEWS/,
	"setup details stay inside Overview without a separate readiness query",
);


// Resource acknowledgement has one owner. Content health reads state and links back.
const assessmentControlSource = await readFile(new URL("./assessment-profile-control.tsx", import.meta.url), "utf8");
const featureControlsSource = await readFile(new URL("./configuration-views.tsx", import.meta.url), "utf8");
const activationSource = scoringControlsSource.slice(scoringControlsSource.indexOf("export function ContentAnalysisActivation()"),
	scoringControlsSource.indexOf("export function ContentScoringControls("));
const contentHealthSource = scoringControlsSource.slice(scoringControlsSource.indexOf("export function ContentScoringControls("));
assert.ok(activationSource.length > 0 && contentHealthSource.length > 0, "Both scoring owners are found");
assert.match(featureControlsSource, /<\/form>\s*<ContentAnalysisActivation \/>/,
	"runtime switches precede the separately gated analysis setup");
assert.doesNotMatch(contentHealthSource, /saveSeoContentScoring\(|<Switch|<Checkbox/);
assert.match(contentHealthSource, /Manage in Feature controls/);
assert.match(activationSource, /nextEnabled && \(!acknowledged \|\| !noticeMatches\)/);
assert.match(activationSource, /expectedRevision: settings\.revision/);
assert.match(activationSource, /\.\.\.\(nextEnabled \? \{ resourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION \} : \{\}\)/);
assert.match(activationSource, /readable && \(policyUnavailable \|\| policy\?\.currentNoticeVersion === CONTENT_SCORING_RESOURCE_NOTICE_VERSION\)/,
	"a readable record with an unavailable acknowledgement permits explicit repair, not implicit admission");
assert.match(assessmentControlSource, /setDraft\(dirty \? draft : result\.data\.selection\.state === "configured"/,
	"reloading a conflicted profile keeps the deliberate draft for review");
{
	const control = compileProduction(assessmentControlSource, {}, (name) => {
		if (name === "react") return React;
		if (name === "react/jsx-runtime") return createRequire(import.meta.resolve("react"))("react/jsx-runtime");
		return {};
	}) as { assessmentProfileBadge: (input: { baseline: unknown; dirty: boolean; pending: boolean }) => { text: string; variant: string } };
	const saved = { state: "configured", collection: "posts", profile: "article", version: 1, revision: "r1" };
	assert.deepEqual(control.assessmentProfileBadge({ baseline: saved, dirty: false, pending: false }), { text: "Saved", variant: "secondary" });
	assert.deepEqual(control.assessmentProfileBadge({ baseline: saved, dirty: true, pending: false }), { text: "Unsaved", variant: "outline" },
		"an unsaved profile choice is never labelled Saved");
	assert.equal(control.assessmentProfileBadge({ baseline: { state: "unconfigured", collection: "posts", revision: null }, dirty: true, pending: false }).text, "Unsaved");
	assert.equal(control.assessmentProfileBadge({ baseline: null, dirty: false, pending: true }).text, "Loading");
	assert.match(assessmentControlSource, /<Badge variant=\{badge\.variant\}>\{badge\.text\}<\/Badge>/);
}
assert.match(contentHealthSource, /!assessmentConfigured \|\| assessmentDirty/);
assert.match(contentHealthSource, /kind === "resume" && \(!enabled \|\| !runAssessmentConfigured/);
assert.match(source, /refreshing=\{refresh\.isPending\}\s*sessionDisabled=\{savedAnalysis\.isPending \|\| !analysisAdmitted\}/,
	"an inactive action has no loading spinner until a session request actually runs");


assert.match(savedPanelSource, /result\.success \|\| result\.error === "profile_required" \|\| result\.error === "profile_unavailable"/);
assert.match(savedPanelSource, /invalidateQueries\(\{ queryKey: collectionAnalysisProfileKey\(collection\), exact: true \}\)/,
	"the result refreshes its exact collection and never writes over a profile draft");
assert.match(contentHealthSource, /if \(scoreScanNeedsProfileRefresh\(result\)\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: collectionAnalysisProfileKey\(requestedCollection\), exact: true \}\)/);
assert.match(contentHealthSource, /drive\(\(\) => sendScoreScanCommand\(kind, view\), view\.scope\.collection\)/);
assert.match(contentHealthSource, /\}, startRequest\.collection\)/,
	"a late start response recovers its requested collection, not a newer selection");
assert.match(savedPanelSource, /const \[assessmentDisclosureOpen, setAssessmentDisclosureOpen\] = React\.useState\(false\)/,
	"analysis setup starts closed for every profile state");
assert.match(savedPanelSource, /open=\{assessmentDisclosureOpen\}/);
assert.doesNotMatch(savedPanelSource, /setAssessmentDisclosureOpen\(\(current\)|assessmentDisclosureOpen \?\?/,
	"a profile response cannot reopen or close the user-controlled disclosure");
assert.equal((savedPanelSource.match(/\{analysisOptionsElement\(sessionCheck\)\}/g) ?? []).length, 1,
	"the same keyed form remains mounted across profile loading, errors, empty and scored states");
assert.match(savedPanelSource, /<details key=\{"assessment:" \+ collection\}/);
assert.doesNotMatch(savedPanelSource, /if \(scoringEnabled[^\n]*return <>/, "profile and history refreshes retain the workflow owner");
assert.match(savedPanelSource, /const analysisOptionsElement = \(sessionCheck: React\.ReactNode\) => \(\s*<details[\s\S]*?<summary>Analysis options<\/summary>\s*<section[^>]*>\s*<h4>Analysis settings<\/h4>\s*\{assessmentControl\}\s*<\/section>[\s\S]*?\{sessionCheck\}\s*<\/details>\s*\);/,
	"configured and unconfigured states retain the same profile control regardless of automatic admission");
assert.equal((savedPanelSource.match(/<details\b/g) ?? []).length, 2,
	"below the checks, Analysis options is the panel's one disclosure besides metadata ownership in Advanced");

// --- Panel shell + registration -------------------------------------------
assert.match(
	source,
	/<section[\s\S]*className="shipit-seo-native-panel shipit-seo-native-panel--sidebar"[\s\S]*data-tone=\{tone\}/,
);
assert.doesNotMatch(registrationSource, /slot: "seo"/);
assert.doesNotMatch(registrationSource, /mode: "replace"/);
assert.doesNotMatch(registrationSource, /placement: "main"/);
assert.match(source, /Save this entry before running SEO analysis\./);
assert.match(adminSource, /import "\.\/content-editor\.css";/);
assert.match(adminSource, /<QueryClientProvider client=\{queryClient\}>/);
assert.deepEqual(sessionSource.match(/^import [^;]+;$/gm), [
	'import { QueryClient } from "@tanstack/react-query";',
	'import { createEntrySchemaPanelStore, type EntrySchemaPanelStore } from "./entry-schema-model.ts";',
]);
assert.equal((sessionSource.match(/^export /gm) ?? []).length, 2);
assert.match(
	sessionSource,
	/^export const contentExtensionQueryClient = new QueryClient\(\{\s*defaultOptions: \{\s*queries: \{\s*refetchOnReconnect: false,\s*refetchOnWindowFocus: false,\s*retry: 1,\s*\},\s*\},\s*\}\);$/m,
);
assert.match(
	sessionSource,
	/^const entrySchemaPanelStores = new Map<string, EntrySchemaPanelStore>\(\);\nexport function entrySchemaPanelStoreFor\(ref: string\): EntrySchemaPanelStore \{\s*let store = entrySchemaPanelStores\.get\(ref\);\s*if \(!store\) \{\s*store = createEntrySchemaPanelStore\(\);\s*entrySchemaPanelStores\.set\(ref, store\);\s*\}\s*return store;\s*\}$/m,
);
assert.match(
	source,
	/^import \{ contentExtensionQueryClient, entrySchemaPanelStoreFor \} from "\.\/content-extension-session\.ts";$/m,
);
assert.doesNotMatch(
	source,
	/new QueryClient\(|entrySchemaPanelStores|createEntrySchemaPanelStore|function entrySchemaPanelStoreFor/,
	"session state lives in content-extension-session.ts, which a component refresh does not re-execute",
);
assert.match(source, /const store = entrySchemaPanelStoreFor\(ref\);/);
assert.match(
	source,
	/<QueryClientProvider client=\{contentExtensionQueryClient\}>[\s\S]*?<SeoScoreCell \{\.\.\.context\} \/>/,
);
assert.match(
	source,
	/<QueryClientProvider client=\{contentExtensionQueryClient\}>[\s\S]*?<SeoEditorPanel \{\.\.\.context\} \/>/,
);
assert.match(source, /^export function SeoScoreCellRoot\(context: ContentListColumnCellContext\) \{$/m);
assert.match(source, /^export function SeoEditorPanelRoot\(context: ShipitContentEditorPanelContext\) \{$/m);
const panelRootSource = source.slice(source.indexOf("export function SeoEditorPanelRoot("), source.indexOf("function StoredScoreHistory("));
assert.match(panelRootSource, /const brand = useSeoHostBrand\(hostClient === contentExtensionQueryClient \? null : hostClient\);/,
	"the editor panel names the plugin from the host manifest, read without a request");
assert.match(panelRootSource, /<SeoBrandProvider value=\{brand\}>[\s\S]*<SeoEditorPanel \{\.\.\.context\} \/>[\s\S]*<\/SeoBrandProvider>/);
assert.deepEqual(
	(source.match(/^export .+$/gm) ?? []).filter((line) => !/^export function [A-Z]\w*\(/.test(line)),
	[],
	"content-extensions.tsx exports only React components",
);
assert.doesNotMatch(source, /content-extension-registration/, "the registration module imports the roots, never the reverse");
assert.deepEqual(registrationSource.match(/^import [^;]+;$/gm), [
	'import type { ContentEditorPanelExtension, ContentListColumnExtension } from "@emdash-cms/admin";',
	'import { SeoEditorPanelRoot, SeoScoreCellRoot } from "./content-extensions.tsx";',
]);
assert.equal((registrationSource.match(/^export /gm) ?? []).length, 2);
assert.match(
	registrationSource,
	/export const contentListColumns: ContentListColumnExtension\[\] = \[\s*\{\s*id: "shipit-seo:score",\s*label: "SEO",\s*order: 50,\s*align: "start",\s*cell: SeoScoreCellRoot,\s*\},\s*\];/,
);
assert.match(
	registrationSource,
	/export const contentEditorPanels: ContentEditorPanelExtension\[\] = \[\s*\{\s*id: "shipit-seo:analysis",\s*title: "Advanced SEO",\s*order: 50,\s*component: SeoEditorPanelRoot,\s*\},\s*\];/,
);
assert.match(
	adminSource,
	/^export \{ contentEditorPanels, contentListColumns \} from "\.\/content-extension-registration\.ts";$/m,
);
assert.doesNotMatch(adminSource, /from "\.\/content-extensions\.tsx"/);
assert.match(editorCss, /container:\s*shipit-seo-panel\s*\/\s*inline-size/);
assert.match(
	editorCss,
	/shipit-seo-native-panel__body-inner[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
);
assert.match(
	editorCss,
	/shipit-seo-native-panel__analysis-layout[\s\S]*?repeat\(2,\s*minmax\(330px,\s*1fr\)\)/,
);
assert.doesNotMatch(source, /Development URL in use\./);
assert.doesNotMatch(editorCss, /shipit-seo-native-preview__environment/);
assert.match(editorCss, /shipit-seo-entry-schema__review-note/);
assert.match(editorCss, /\[data-theme="dark"\]/);

// --- Score ring header -----------------------------------------------------
assert.match(source, /shipit-seo-native-panel__ring-progress/);
assert.match(source, /strokeDasharray=\{`\$\{ringProgress\.toFixed\(1\)\}/);
assert.match(source, /if \(score && hasCurrentEditorAnalysis\(score\)\) return \{ kind: score\.persistence === "session" \? "session" : "stored", score \};\s*return analysis \? \{ kind: "browser", analysis \} : null;/,
	"one source: the verified result of this saved version, otherwise the browser checks");
assert.equal((source.match(/editorAnalysisSource\(score, basicAnalysis\)/g) ?? []).length, 1,
	"the header, checklist and scope note share one source decision");
assert.doesNotMatch(source, /: \x60Analysis needs refreshing\. \$\{summary\}\x60/,
	"an unverified result is not announced as a proven mismatch");
assert.doesNotMatch(source, /FullAnalysisChecklist|FullAnalysisCalculation|BasicAnalysisChecklist|About these checks|How this assessment was calculated|Verified saved analysis|summarizeSeoChecks\(analysis\.result/,
	"the second checklist, the duplicate calculations and the separate browser notes are gone");
assert.equal((source.match(/<AnalysisChecklist\b/g) ?? []).length, 1, "one checklist element serves every source");
assert.equal((source.match(/<AnalysisScopeNote\b/g) ?? []).length, 1, "one compact scope note describes the header result");
assert.doesNotMatch(source, /Previous" : "Saved"\} score: \$\{score\.score\}\/100/, "a stale or earlier result never shows its number");
assert.match(source, /<strong>\{label\}<\/strong>/);
assert.match(source, /display && display\.score !== null && display\.qualifier/);
assert.doesNotMatch(source, /aria-label="Refresh analysis"/, "the header does not compete with the durable action");
assert.match(source, /<h4>Temporary session check<\/h4>/);
assert.doesNotMatch(source, /<summary>(?:Temporary session check|Analysis settings|Saved analysis &amp; history)<\/summary>/,
	"the three analysis extras are sections of Analysis options, not separate disclosures");
assert.match(source, /contentScoreColumnPresentation\(score\)/);
assert.match(source, /data-freshness=\{freshness\}/);
assert.match(contentScoreColumnSource, /Saved SEO score/);
assert.match(contentScoreColumnSource, /Last known SEO score/);

// --- Section tabs: Analysis and Advanced switch in place; Social and Schema
// --- are separate openers under the preview that open Edit SEO on that tab.
assert.match(source, /role="tablist"\s*aria-label="SEO sections"/);
assert.doesNotMatch(source, /role="toolbar"|aria-pressed=\{activeView/);
assert.match(source, /role="tab"[\s\S]{0,200}aria-selected=\{activeView === "analysis"\}\s*tabIndex=\{activeView === "analysis" \? 0 : -1\}\s*data-strip-entry="analysis"[\s\S]{0,300}Analysis/);
assert.match(source, /role="tab"[\s\S]{0,200}aria-selected=\{activeView === "advanced"\}\s*tabIndex=\{activeView === "advanced" \? 0 : -1\}\s*data-strip-entry="advanced"[\s\S]{0,300}Advanced/);
assert.equal((source.match(/role="tab"\n/g) ?? []).length, 2, "the strip holds exactly two tabs");
for (const [view, icon] of [["social", "ShareNetwork"], ["schema", "TreeStructure"]] as const) {
	assert.match(source, new RegExp(`data-dialog-opener="${view}"[\\s\\S]{0,300}aria-haspopup="dialog"[\\s\\S]{0,200}openDialogFrom\\("${view}", event\\.currentTarget\\)[\\s\\S]{0,120}<${icon}[^>]*aria-hidden="true"`),
		view + " opens the dialog from its labelled button with its semantic icon");
}
assert.doesNotMatch(source, /opener-glyph|\bAppWindow\b/, "the openers have no trailing window glyph or unused import");
// Launchers disable until the preview exists so a queued request can never
// pop the dialog open later, disconnected from the user's click.
assert.match(source, /disabled=\{!preview\}/);

// --- Focus keywords: chips, primary-first, Enter/Backspace, autosave -------
assert.match(source, /className="shipit-seo-native-panel__keyword-field"/);
assert.match(source, /data-primary=\{index === 0 \|\| undefined\}/);
assert.match(source, /data-tone=\{coverage\?\.tone \?\? undefined\}/);
assert.doesNotMatch(source, /Enter to add, up to 5\. The primary keyword drives analysis/);
assert.match(source, /className="shipit-seo-native-panel__keyword-heading"/);
assert.match(source, /className="shipit-seo-native-panel__keyword-chip-label"/);
assert.doesNotMatch(source, /shipit-seo-native-panel__workflow-help/);
assert.match(source, /event\.key === "Backspace" && !inputValue && keywords\.length/);
assert.match(source, /maxLength=\{SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH\}/);
assert.match(source, /keywordCheckCoverage\(keyword, index === 0 \? "primary" : "secondary", coverageAnalysis\)/,
	"chips read the same rows as the checklist");
assert.doesNotMatch(source, /seoKeywordCoverage|resolveSeoLiveSearchPreview/, "chips no longer count preview text apart from the checks");
assert.match(source, /: source\?\.score \?\? null;/, "a verified stored source supplies chip coverage");
assert.match(source, /\? keywordCoverageConfirmed \? \{ \.\.\.source\.analysis\.result, keywords: keywordsValue \} : null/,
	"browser rows supply chip coverage only from a confirmed preview");
assert.match(source, /This \{contentLabel\.toLocaleLowerCase\(\)\} is pillar content/);
assert.match(source, /Mark this as a main reference page for its topic\./);
assert.doesNotMatch(source, /stricter content-depth and internal-linking checks/);
assert.match(source, /createCancellableDebounce/);
assert.match(source, /KEYWORD_AUTOSAVE_DELAY_MS/);
assert.match(source, /keywordAutosave\.cancel\(\)/);
assert.match(source, /saveSeoFocusKeywords/);

// --- Keyword ownership: profile statement vs inherited content keywords ----
// The draft/baseline pair tracks the PROFILE STATEMENT (null = none made);
// seeding from the effective analyzer keywords would present an inherited
// content keyword as saved plugin data.
assert.match(savedPanelSource, /setKeywordBaseline\(profile\?\.keywords \?\? null\)/);
assert.doesNotMatch(
	source,
	/setKeywordBaseline\([\s\S]{0,80}(?:score|sessionScore)\??\.keywords/,
	"the baseline must come from the profile statement, never effective keywords",
);
assert.match(source, /resolveEditorBasicKeywordOwnership\(\{/);
assert.match(source, /const keywordOwnership = basicKeywordOwnership \?\?/);
assert.match(source, /data-inherited=\{inherited \|\| undefined\}/);
assert.match(source, />\s*Inherited\s*</);
// Any keyword-list edit materialises the visible list as the explicit draft.
assert.match(source, /keywordDraft \?\? displayKeywords/);
// A pillar-only change sends `keywords: null` (statement preserved server-side).
assert.match(source, /keywordStatementsMatch\(keywordDraft, keywordBaseline\)/);
assert.match(source, /keywords: SeoKeywordStatement;/);

// --- Save state machine: truthful, no automatic retry, draft-preserving ----
assert.match(source, /deriveProfileSaveState\(\{/);
assert.match(source, /profileSaveErrorFromRoute\(/);
assert.match(source, /saveState\.status === "pending"/);
assert.match(source, />\s*Retry\s*<\/button>/);
// The debounce-pending state must never claim an in-flight save.
assert.doesNotMatch(source, /Saving profile…/);
assert.match(source, /"Unsaved changes"/);
// A stale success echo must never clobber a newer draft.
assert.match(source, /keywordStatementsMatch\(keywordDraftRef\.current, variables\.keywords\)/);

// Draft ownership and acknowledgement identities have behavioral store checks.
assert.doesNotMatch(source, /set[A-Za-z]*\(\((?:current|previous|prev)\) => \{[\s\S]{0,400}?onDraftChange/);
assert.doesNotMatch(source, /HOST_SYNC_DEBOUNCE_MS|scheduleHostSync|syncDraftToHostRef|flushHostSync/);
assert.match(source, /aria-label="Preview device"/);
assert.match(source, /aria-pressed=\{device === "desktop"\}/);
assert.match(source, /aria-pressed=\{device === "mobile"\}/);
assert.match(source, /aria-label="Toggle search result page context"[\s\S]{0,200}aria-pressed=\{serpContext\}/);
assert.match(source, /analysisPresentation\(score\)/);

// "Schema in use" lists this entry's records and every other emitted graph; inherited output is never implied absent.
assert.match(source, /<h3[^>]+>Schema in use<\/h3>/);
assert.doesNotMatch(source, /No additional schemas saved for this entry|No custom schema yet|How saving works|Shared custom records/);
assert.match(source, /entrySchemaInUseRows\(\{ items: listed\.items, inherited: listed\.inherited, graphs, collectionLabel, outputEnabled: listed\.outputEnabled \}\)/);
assert.match(source, /entrySchemaNotAddedRows\(\{ items: listed\.items, inherited: listed\.inherited, graphs, collectionLabel, outputEnabled: listed\.outputEnabled, locale \}\)/);
assert.match(source, /Defaults for this entry \(\{defaultRows\.length\}\)/, "the per-entry default switches live in one collapsed disclosure");
assert.match(source, /Switches save immediately, separately from the schema form; EmDash.s built-in graph may remain/);
assert.match(source, /if \(!target \|\| !canSave \|\| !entrySchemaEditorCanSave\(target\)\) return/,
	"submit rechecks the current store value, including guided requirements, before acquiring a write");


// --- Saved results and the durable saved-content action -----------------------
const storedQuerySource = savedPanelSource.match(/const storedScoreQuery = useQuery\(\{[\s\S]*?\n\t\}\);/)?.[0] ?? "";
assert.match(storedQuerySource, /fetchSeoContentScore\(ref, \{ storedOnly: true, snapshotOnly: true, signal \}\)/,
	"the editor reads stored history without a freshness claim");
assert.doesNotMatch(storedQuerySource, /enabled:/, "stored history loads whatever the scoring, settings or profile state");
assert.match(savedPanelSource, /editorSessionScoreForSavedVersion\(\s*storedScoreQuery\.data,\s*entry\.updatedAt \?\? null,\s*storedScoreQuery\.data\.sourceVersion \?\? null,\s*savedVersion,\s*\)/,
	"a stored score from another saved version is out of date even when updatedAt is unchanged");
assert.match(apiSource, /seoAdminApiUrl\("analyze-saved-content"\)[\s\S]{0,200}body: JSON\.stringify\(\{ ref, locale \}\)/,
	"the durable action sends only the reference and locale");
assert.match(apiSource, /parseSeoAdminSavedAnalysisResult\([\s\S]{0,160}ref,\s*\)/);
const savedActionSource = savedPanelSource.slice(savedPanelSource.indexOf("const savedAnalysis = useMutation({"), savedPanelSource.indexOf("const savedNotice ="));
assert.match(savedActionSource, /retry: false/, "an uncertain or denied request is never retried automatically");
assert.match(savedActionSource, /invalidateQueries\(\{ queryKey: \[SCORE_QUERY_SCOPE, "stored-entry", ref\] \}\)/);
assert.match(savedActionSource, /invalidateQueries\(\{ queryKey: \[SCORE_QUERY_SCOPE, "collection", collection\] \}\)/,
	"only this collection's list badges refetch");
assert.match(contentScoreColumnSource, /queryKey: \[SCORE_QUERY_SCOPE, "collection", collection,/, "the invalidated prefix matches the list query key");
assert.match(savedActionSource, /else if \(result\.error === "scoring_disabled" \|\| result\.error === "activation_required"\) \{\s*void settingsQuery\.refetch\(\);/,
	"a disabled refusal reloads the policy without repeating the request");
assert.match(savedActionSource, /if \(result\.success\) \{[\s\S]{0,260}if \(savedReadback\.isCurrent\(request\.readbackToken\)\) sessionAnalysis\.invalidate\(\);/,
	"a durable result withdraws an earlier confirmed session result");
assert.doesNotMatch(savedActionSource.replaceAll("sessionAnalysis.invalidate();", ""), /sessionAnalysis/,
	"durable results never start, resume or feed the session controller");
assert.match(savedPanelSource, /const savedAnalysisEpoch = JSON\.stringify\(\[ref, entryLocale, savedVersion, assessmentBoundary\]\);/);
assert.match(savedPanelSource, /savedAnalysisResult\?\.epoch === savedAnalysisEpoch \? savedAnalysisResult\.notice : null/,
	"a late answer for an older saved version is not shown as current");
const savedActionElementSource = savedPanelSource.slice(savedPanelSource.indexOf("const savedActionElement = ("), savedPanelSource.indexOf("const panelState ="));
assert.match(savedActionElementSource, /savedAnalysis\.mutate\(\{ epoch: savedAnalysisEpoch, locale: entryLocale, savedVersion, readbackToken: savedReadback\.begin\(\) \}\)/);
assert.match(savedActionElementSource, /disabled=\{savedAnalysis\.isPending \|\| refresh\.isPending \|\| !manualSavedAnalysisAdmitted\}/);
assert.match(savedActionElementSource, /size="sm"\s*variant="secondary"\s*title=\{analysisHelp\}/,
	"the optional saved-analysis action is a small secondary button with an accessible explanation");
assert.match(savedActionElementSource, /\{savedAnalysis\.isPending \? "Saving analysis\.\.\." : "Save analysis"\}/);
assert.match(savedPanelSource, /const analysisHelp = manualState\.detail \?\? "Save a result for the saved content and keywords\. Unsaved page edits are not included\.";\s*\/\/ This action never activates/);
assert.match(savedPanelSource, /const analysisBlockedReason = !manualSavedAnalysisAdmitted && \(assessmentDirty \|\| !analysisTargetReady\) \? manualState\.detail : null;/,
	"a reason the editor must act on is shown, since the disabled Save analysis button cannot take focus; loading reasons are not");
assert.match(savedPanelSource, /\{analysisBlockedReason \? <p className="shipit-seo-analysis-action__reason">\{analysisBlockedReason\}<\/p> : null\}/);
assert.doesNotMatch(savedActionElementSource, /sessionAnalysis|refresh\.mutate/, "the durable action is separate from session Refresh");
assert.equal((savedPanelSource.match(/\{savedActionElement\}/g) ?? []).length, 1, "one durable action serves both unscored and scored entries");
assert.doesNotMatch(savedPanelSource, /headerAction=|analysisHelp=\{analysisHelp\}/, "the real saved-entry panel keeps optional saving out of the score header");
assert.match(savedPanelSource, /headerNotice=\{savedActionNotice\}/, "save outcomes and recovery remain visible without reopening options");
assert.match(savedPanelSource, /const savedActionNotice = savedNoticeElement \|\| keywordReloadElement \|\| analysisBlockedReason \? \(\s*<div className="shipit-seo-analysis-action">\s*\{analysisBlockedReason [^\n]*\n\s*\{savedNoticeElement\}\s*\{keywordReloadElement\}/);
assert.match(savedPanelSource, /renderLocalAnalysis=\{\(_onFix, checklist, sessionCheck\) => \(<>\s*\{checklist \?\? \([\s\S]*?\)\}\s*\{analysisOptionsElement\(sessionCheck\)\}\s*<\/>\)\}/,
	"the one checklist is followed only by the closed Analysis options");
assert.match(savedPanelSource, /<h4>Saved analysis &amp; history<\/h4>\s*\{savedActionElement\}\s*<p className="shipit-seo-muted">\{analysisHelp\}<\/p>\s*\{unavailableAnalysis \?\? storedHistory\(/,
	"the deliberate save and its help remain inside the closed history/options section");
assert.match(savedPanelSource, /\{refreshAlert\}\s*<SeoAnalysisDisclosure/, "refresh errors preserve the keyed workflow");
assert.match(savedActionSource, /savedAnalysisNotice\(result, request\.savedVersion\)/, "a result is bound to the saved version it was requested for");

assert.match(savedPanelSource, /read: \(requestedRef, signal\) => fetchSeoContentScore\(requestedRef, \{ storedOnly: true, signal \}\)/,
	"only the explicit durable readback requests server-verified stored freshness");
assert.match(savedActionSource, /savedReadback\.verify\(result, \{\s*ref, locale: request\.locale, savedVersion: request\.savedVersion,\s*\}, request\.readbackToken\)/,
	"the readback binds the accepted score to the requested entry, language, saved version and boundary");
assert.match(savedActionSource, /savedAnalysisReadbackWarning\(confirmation\)/);

assert.match(savedActionSource, /void Promise\.allSettled\(\[/,
	"passive history and list refetches do not delay the bounded readback");
assert.doesNotMatch(savedActionSource, /await Promise\.all/,
	"unbounded cache refetches cannot keep the durable action pending");

assert.match(savedActionSource, /if \(warning\) notice = \{ tone: "warning", message: `\$\{notice\.message\} \$\{warning\}` \}/,
	"failed freshness confirmation preserves the durable outcome and adds its own warning");
assert.match(savedPanelSource, /verifiedSavedAnalysisForTarget\(savedReadbackState, \{ ref, locale: entryLocale, savedVersion \}\)/);
assert.match(savedPanelSource, /storedSnapshot,\s*verifiedStoredScore,/);
assert.match(savedPanelSource, /const settingsBoundary = JSON\.stringify\(\[settingsQuery\.data\?\.values \?\? null, scoringPolicy \?\? null\]\)/);
assert.match(savedPanelSource, /const profileBoundary = JSON\.stringify\(\[profileQuery\.data\?\.profile \?\? null, assessmentBoundary\]\)/);
assert.match(savedPanelSource, /savedReadback\.invalidate\(\);\s*\}, \[savedReadback, savedVersion, entryLocale, scoringEnabled, settingsBoundary, profileBoundary, settingsQuery\.isError, profileQuery\.isError\]\)/,
	"saved inputs and stable settings/profile values withdraw the explicit proof");
assert.match(savedPanelSource, /const revalidate = \(\) => \{\s*savedReadback\.invalidate\(\)/,
	"returning to the page invalidates the stored proof without another readback");
assert.match(savedPanelSource, /getQueryCache\(\)\.subscribe[\s\S]{0,300}event\.action\.type === "invalidate"[\s\S]{0,300}savedReadback\.invalidate\(\)/,
	"entry metadata writes such as schema saves withdraw the proof");
assert.equal((savedPanelSource.match(/savedReadback\.verify\(/g) ?? []).length, 1,
	"no mount, focus or background readback is added");
for (const mutation of ["directivesSave", "socialSave"]) {
	assert.match(savedPanelSource, new RegExp(`const ${mutation} = useMutation\\(\\{\\s*onMutate: \\(\\) => savedReadback\\.invalidate\\(\\)`),
		"a local settings write withdraws current proof before its response");
}
assert.match(savedPanelSource, /writeEpoch === keywordWriteEpoch\.current\) setKeywordWriteUnconfirmed\(false\)/,
	"only a matching save/read acknowledgement confirms the keyword baseline");

assert.match(savedPanelSource, /const scoringUnknown = settingsReady && \(settingsQuery\.data\?\.values === null \|\| scoringPolicy\?\.state === "unavailable"\);/,
	"settings without values are an unknown scoring state, not scoring off");
assert.match(savedPanelSource, /const panelState = editorScoreStateCopy\(\{ scoringEnabled, scoringUnknown, storedUnavailable: storedScoreQuery\.isError,[\s\S]*?settingsUnavailable:[\s\S]*?profileRequired, profileUnavailable, profileLoading:/,
	"an unreadable stored score is labeled from the stored query state, not as never analyzed");
assert.match(savedPanelSource, /<strong>\{panelState\.heading\}<\/strong>\s*<span>\{panelState\.detail\}<\/span>/);
assert.match(savedPanelSource, /\{storedHistory\(!assessmentConfigured/);
assert.doesNotMatch(savedPanelSource, /Content scoring is off, so this saved result is not updated/);
assert.match(savedPanelSource, /Automatic analysis: \{scoringEnabled/);
assert.match(savedPanelSource, /Browser checks above are separate and are not saved to history/);
assert.match(source, /function StoredScoreHistory\(\{ score, notice \}/);
const storedHistorySource = source.slice(source.indexOf("function StoredScoreHistory("), source.indexOf("function SavedSeoEditorPanel("));
assert.match(storedHistorySource, /<div className="shipit-seo-native-panel-state">/);
assert.doesNotMatch(storedHistorySource, /role=/, "a recorded score is not announced as a live update");
assert.match(savedPanelSource, /const historyScore = verifiedStoredScore \?\? storedSnapshot;\s*const storedHistory = \(notice: string\) => historyScore \? <StoredScoreHistory score=\{historyScore\}/,
	"history shows the verified readback the header shows, not the snapshot it replaced");

// --- Stale-request cancellation --------------------------------------------
assert.doesNotMatch(savedPanelSource, /sessionAnalysis\.start\(\)/);
assert.match(savedPanelSource, /fetchSeoAnalysisProfile\(ref, \{ signal \}\)/);
assert.ok(
	savedPanelSource.indexOf("const settingsQuery = useQuery({") < savedPanelSource.indexOf("const profileQuery = useQuery({"),
);
const exactProfileQuerySource = savedPanelSource.slice(savedPanelSource.indexOf("const profileQuery = useQuery({"), savedPanelSource.indexOf("const analysisAdmitted ="));
assert.match(exactProfileQuerySource, /enabled: true/);
assert.doesNotMatch(exactProfileQuerySource, /scoringEnabled|assessmentConfigured/, "exact keyword profiles load independently of optional analysis");
assert.match(savedPanelSource, /if \(!analysisAdmitted \|\| !profileReady \|\| !profileQuery\.data\) return/);
assert.match(savedPanelSource, /const unavailableAnalysis = !score \|\| !assessmentConfigured \?/);
assert.doesNotMatch(savedPanelSource, /"Not analyzed"|No saved analysis yet/, "the panel copy comes only from the state helper");
assert.match(savedPanelSource, /profileQuery\.isFetchedAfterMount && profileQuery\.isSuccess && !profileQuery\.isFetching/);
assert.match(savedPanelSource, /refetchOnMount: "always"/);
assert.match(
	savedPanelSource,
	/if \(!sessionAnalysis\.hasAnalysisOptions\(analysisOptions\)\) \{\s*sessionAnalysis\.cancel\(\);\s*void sessionAnalysis\.updateAnalysisOptions\(analysisOptions\);\s*\}/,
	"a refetch of the same profile never cancels the active analysis",
);
assert.match(savedPanelSource, /keywordStatementsMatch\(score\.profileKeywords \?\? null, analysisOptions\.keywords\)/);
assert.match(savedPanelSource, /score\.pillar !== \(analysisOptions\.pillar \?\? false\)/);
assert.match(
	source,
	/fetchSeoAdminEntryPreview\(ref, undefined, \{ entryOnly: true, savedVersion, signal \}\)/,
);
assert.match(apiSource, /signal\?: AbortSignal/);
assert.match(apiSource, /signal: options\.signal/);
assert.match(source, /visibleItems/);
assert.match(source, /contentScorePageQueryOptions\(collection, refs, locale\)/);
assert.match(contentScoreColumnSource, /fetchSeoContentScores/);
assert.match(contentScoreColumnSource, /refs/);
assert.match(
	contentScoreColumnSource,
	/storedOnly:\s*true/,
	"content list visits must only read persisted scores",
);
assert.match(source, /auditSeoContent\(\[requestedRef\], \{ signal \}\)/);
assert.match(savedPanelSource, /React\.useEffect\(\(\) => \(\) => \{\s*refreshRequest\.current \+= 1;\s*sessionAnalysis\.cancel\(\);\s*savedReadback\.invalidate\(\);\s*\}, \[sessionAnalysis, savedReadback\]\)/);
assert.match(savedPanelSource, /request !== refreshRequest\.current/);
assert.match(savedPanelSource, /await queryClient\.cancelQueries\(\{ queryKey: profileKey, exact: true \}\)/);
assert.match(source, /sessionAnalysis\.updateSavedVersion\(entry\.updatedAt \?\? null, savedVersion\)/);

assert.match(source, /Temporary check of saved content/);
assert.match(source, /Content or settings changed since the previous analysis/);
assert.match(source, /scoreMatchesProfile\(profileScore, profileQuery\.data\?\.profile \?\? null\)/);
assert.match(source, /Previous analysis; not verified for the current saved content/);
assert.match(source, /sessionState\.error && scoringEnabled \? <p role="alert">\{sessionState\.error\}/);
assert.match(savedPanelSource, /if \(!profileInitialized\.current \|\| \(keywordStatementsMatch\(keywordDraft, keywordBaseline\)/);
assert.match(savedPanelSource, /profileOnly: true/);
assert.match(savedPanelSource, /queryClient\.setQueryData\(profileKey, result\)/);
assert.match(apiSource, /options\.profileOnly && result\.item !== null/);
assert.match(apiSource, /analysisProfile\.requestedRef/);
assert.match(source, /className="shipit-seo-native-panel__general-editor">\s*\{renderKeywordEditor\?\.\(tabId\)\}/);
assert.match(source, /renderKeywordEditor=\{keywordEditorVisible \? \(tabId\) => \(<>[\s\S]*?<FocusKeywordEditor/);
assert.doesNotMatch(source, /No saved focus keywords|Analyze now/);
assert.match(savedPanelSource, /Retry settings/);
assert.match(savedPanelSource, /Manage automatic analysis/);
assert.doesNotMatch(savedPanelSource, /placeholderData/);
// A saved content version change or explicit refresh drives analysis.
assert.doesNotMatch(source, /refetchInterval/);
assert.match(source, /refetchOnWindowFocus: false/);
assert.match(source, /refetchOnReconnect: false/);
assert.match(source, /previewQueryKey\(ref, savedVersion, previewLocale\)/);
const previewQuerySource = source.slice(source.indexOf("const previewQuery = useQuery({"), source.indexOf("const refresh = {"));
assert.doesNotMatch(previewQuerySource, /placeholderData/);
assert.match(previewQuerySource, /if \(!result.success\) throw new Error/);
assert.match(previewQuerySource, /savedSnapshotMatches/);
assert.match(previewQuerySource, /sourceVersion: savedVersion/);
assert.doesNotMatch(source, /setQueryData\(resolvedPreviewKey/);
assert.doesNotMatch(source, /The search preview differs from the saved draft/);

// Saved adapters feed the same fixed-profile cards in both preview locations.
assert.match(source, /const datePrefix = seoSnippetDatePrefix\(preview\.search\.publishedAt, locale\);\s*const savedModel = buildSavedSearchPreviewModel\(preview, device, datePrefix\);/);
assert.match(source, /buildSocialEditorPreview\(\{/);
assert.match(source, /<ResolvedSearchPreview model=\{model\}/);
assert.match(source, /descriptionDisplay=\{descriptionDisplay\} lastLoaded=\{lastLoaded\}/);
assert.match(source, /resultPage descriptionDisplay="external" lastLoaded=\{previewError\}/);
assert.match(source, /locale=\{locale\} descriptionDisplay="external" lastLoaded=\{previewError\}/);
assert.match(source, /const snippet = <SearchSnippetFrame[^;]*lastLoaded=\{previewError\}/);
assert.match(source, /\{previewRetryNotice\}/);
assert.match(source, /<ResolvedSocialPreview model=\{view.model\} fieldBasis=\{view.fieldBasis\} caption=\{view.caption\} loadImage/);
assert.match(source, /className="shipit-seo-native-preview-model__noindex"[\s\S]*?<span>Noindex is on\. Search engines are asked not to show this page\.<\/span>/,
	"the noindex state reads as a short styled note");
assert.doesNotMatch(source, /Noindex directive in resolved metadata/);
for (const [name, text] of [
	["social-editor-preview.ts", await readFile(new URL("./social-editor-preview.ts", import.meta.url), "utf8")],
	["native-seo-editor-preview.ts", await readFile(new URL("./native-seo-editor-preview.ts", import.meta.url), "utf8")],
	["native-seo-editor-fields.tsx", nativeSeoFieldsSource],
] as const) assert.doesNotMatch(text, /[Ll]ast-loaded|awaits save and refreshed metadata|Save other post changes/,
	`${name} shows editors short wording; only a failed refresh names last-loaded values`);
assert.match(source, /indexingNote=\{!exclusionBannerShown\}/, "the sidebar snippet leaves the noindex note to the Excluded from search banner");
assert.match(source, /searchExclusionShown=\{Boolean\(searchExclusion\)\}/);
// The date prefix comes from the module the field estimate and Description fit share, in UTC and the entry locale.
assert.equal(snippetFitModule.seoSnippetDatePrefix("2026-10-18T23:30:00-05:00", "en"), "Oct 19, 2026 \u2014 ");
assert.equal(snippetFitModule.seoSnippetDatePrefix("2026-10-18T09:00:00Z", "nl"), new Intl.DateTimeFormat("nl", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date("2026-10-18T09:00:00Z")) + " \u2014 ");
assert.equal(snippetFitModule.seoSnippetDatePrefix(null, "en"), "");
assert.doesNotMatch(source, /function snippetDatePrefix/, "the editor has no second date prefix");
assert.match(source, /key=\{preview.content.ref \+ ":" \+ \(locale \?\? ""\)\}/);
assert.match(source, /<Dialog.Root open=\{editing\}/);
assert.match(source, /<Dialog size="lg" className="shipit-seo-snippet-dialog">/);
assert.match(source, /<Dialog.Title>Edit SEO<\/Dialog.Title>/);
assert.doesNotMatch(source, /View previews|SEO settings<\/Dialog|Saved entry<\/small>/);
assert.match(source, /<PencilSimple size=\{13\} aria-hidden="true" \/>\s*Edit snippet\s*<\/button>/);
assert.match(source, /<div className="shipit-seo-native-preview__heading">\s*<span>Search preview<\/span>\s*<\/div>/,
	"the card's own status line is the one preview status, so the heading repeats none");
assert.match(source, /const snippet = <SearchSnippetFrame preview=\{preview\} device="mobile" locale=\{locale\} lastLoaded=\{previewError\} updating=\{previewUpdating\}/);
assert.match(source, /lastLoaded=\{lastLoaded\} updating=\{updating \|\| nativeEditor\?\.previewUpdating\}/,
	"a newer saved entry being read and adopted values both read Updating preview... on the card");
assert.match(source, /data-dialog-view=\{view\}/);
assert.match(source, /<span>Desktop<\/span>/);
assert.match(source, /<span>Mobile<\/span>/);
assert.match(source, /SerpContext/);
assert.match(source, /\{dialogView === "social" \? \(\s*<>\s*<SocialPreview/);
assert.match(source, /\{dialogView === "schema" \? <EntrySchemaManager/);
assert.match(source, /loading=\{socialState.phase === "saving"\}/);
assert.match(source, /className="shipit-seo-snippet-dialog__metadata-layout"/);
assert.doesNotMatch(source, /focusField|short glow/);
assert.match(source, /setDialogRequest\(null\);\s*\}, \[preview\?\.content\.ref, locale\]\)/);
// Rows keep the shared order (Failed, Partly met, Suggestion, Not checked, Passed); row explanations remain closed.
assert.match(source, /\{group\.rows\.map\(\(row\) => \(\s*<AnalysisCheckRow\s*key=\{row\.check\.id\}/);
assert.doesNotMatch(source, /needsAttention|attentionChecks|isActionableCheck|isOpenReviewNote|group\.note\b/,
	"the editor neither re-sorts rows nor repeats the not-applicable sentence");
assert.doesNotMatch(source, /className="shipit-seo-native-panel__supporting-checks"/);
assert.doesNotMatch(source, /Checks by evidence/);
assert.doesNotMatch(source, /Passed checks and notes/, "unavailable checks are not grouped with passes");
assert.doesNotMatch(source, /"All good"/, "a group summary comes from the evaluation basis");
assert.doesNotMatch(source, /No action needed in this group/);
assert.match(source, /<span data-tone=\{group\.pill\.tone\}>\{group\.pill\.text\}<\/span>/);
assert.match(source, /data-status=\{CHECK_ROW_STATUS\[kind\]\} data-kind=\{kind\} data-basis=\{basis\}/);
assert.match(source, /SEO_CHECK_BASIS_LABELS\[basis\]/);
assert.match(source, /check\.evidence\.source/);
assert.match(source, /shipit-seo-native-panel__check-limitation/);
assert.match(source, /\(action\.target === "keyword" \? canAddKeyword : action\.target === "advanced" \|\| canReviewSnippet\)/,
	"an action is offered only when its field can take focus");
assert.match(source, /aria-label=\{`\$\{action\.verb\}: \$\{label\}`\}/);
assert.match(source, /<span className="shipit-seo-native-panel__check-detail">\{check\.detail\}<\/span>/, "every row states what was measured");
assert.doesNotMatch(source, /<p>\{check\.detail\}<\/p>/, "the finding is not repeated inside the expansion");
assert.match(source, /\{row\.showRecommendation && check\.recommendation \?/, "the recommendation follows the shared row decision, including Not checked rows");
// Historical findings do not describe the current entry.
assert.match(source, /shipit-seo-native-panel__condition/);
assert.match(source, /const currentAnalysis = score !== null && hasCurrentEditorAnalysis\(score\)/);
assert.match(source, /Previous results remain in your score history/);
// Cached session results are reused only after the exact-entry identity read.
assert.match(savedPanelSource, /currentIdentity: \(requestedRef, signal\) => fetchSeoEntryAnalysisIdentity\(requestedRef, \{ signal \}\)/);
assert.match(savedPanelSource, /locale: typeof entry\.locale === "string" \? entry\.locale : null/);
// The panel resumes a kept result only through validation and checks a shown result again on return.
assert.match(savedPanelSource, /void sessionAnalysis\.resume\(\);\s*\}, \[analysisAdmitted, profileReady, profileQuery\.data, assessmentBoundary, sessionAnalysis\]\)/);
// One Refresh applies the refetched profile, then analyzes; a failed profile read is shown.
assert.match(
	savedPanelSource,
	/await sessionAnalysis\.analyze\(\{ keywords: profile\?\.keywords \?\? null, pillar: profile\?\.pillar \?\? false \}\);/,
);
// A stored score is never shown as current in the editor; out of date is the known case.
assert.match(savedPanelSource, /const \{ score, storedOutOfDate \} = selectEditorScore\(\{/);
assert.match(source, /storedOutOfDate\s*\? "Content or settings changed since the previous analysis\."\s*: "This analysis has not been checked against the saved content and current settings\."/);
assert.match(savedPanelSource, /sessionAnalysis\.invalidate\(\);/);
assert.doesNotMatch(savedPanelSource, /keywordStatementsMatch\(previous/);
assert.match(savedPanelSource, /setProfileRefreshFailed\(true\)/);
assert.match(savedPanelSource, /isError: sessionState\.error !== null \|\| profileRefreshFailed/);
assert.match(savedPanelSource, /window\.addEventListener\("focus", revalidate\)/);
assert.match(savedPanelSource, /document\.addEventListener\("visibilitychange", revalidate\)/);
assert.match(savedPanelSource, /void sessionAnalysis\.revalidate\(\)/);
assert.match(savedPanelSource, /window\.removeEventListener\("focus", revalidate\)/);
assert.match(apiSource, /seoAdminApiUrl\("entry-analysis-identity"\)/);
assert.match(css, /shipit-seo-native-panel__group > summary > span\[data-tone="info"\]/);
assert.match(css, /shipit-seo-native-panel__group > summary > span\[data-tone="neutral"\]/);
// Group pills read colour variables; the host's data-mode switches them to the keyword chip's dark tones.
for (const tone of ["good", "review", "poor", "info"]) {
	assert.match(css, new RegExp(`__group > summary > span\\[data-tone="${tone}"\\] \\{\\s*background: var\\(--shipit-seo-pill-${tone}-background\\);\\s*color: var\\(--shipit-seo-pill-${tone}-color\\);`), tone);
}
const darkPills = css.match(/:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-native-panel \{[^}]*\}/)?.[0] ?? "";
for (const [name, value] of [
	["good-background", "color-mix(in srgb, #12b76a 15%, transparent)"], ["good-color", "#75e0a7"],
	["review-background", "color-mix(in srgb, #f79009 14%, transparent)"], ["review-color", "#fec84b"],
	["poor-background", "color-mix(in srgb, #f04438 14%, transparent)"], ["poor-color", "#fda29b"],
	["info-background", "rgb(46 144 250 / 18%)"], ["info-color", "#b2ccff"],
]) assert.ok(darkPills.includes(`--shipit-seo-pill-${name}: ${value};`), name);
for (const [name, value] of [["good-color", "#067647"], ["review-color", "#8a5a00"], ["poor-color", "#b42318"], ["info-color", "#1849a9"]])
	assert.ok(css.includes(`--shipit-seo-pill-${name}: ${value};`), "the light palette stays: " + name);
assert.match(editorCss, /\[data-mode="dark"\]\)\s*\.shipit-seo-native-panel--sidebar\s*\.shipit-seo-native-panel__check\[data-status="suggestion"\]\s*\.shipit-seo-native-panel__check-icon/);
assert.match(editorCss, /__check\[data-status="suggestion"\]\s*\.shipit-seo-native-panel__check-icon \{\s*color: #1570ef;/, "suggestions use the info tone");
// The host marks dark mode with data-mode alone, so a class or data-theme dark selector never applies without that variant.
for (const [name, sheet] of [["admin.css", css], ["content-editor.css", editorCss]] as const) {
	for (const [, prelude] of sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)) {
		const selectors = prelude.split(",").map((selector) => selector.trim());
		for (const selector of selectors) {
			const legacy = selector.match(/^(?:\.dark|\[data-theme="dark"\]) (.+)$/);
			if (legacy) assert.ok(selectors.includes(`[data-mode="dark"] ${legacy[1]}`), `${name}: ${selector} has a data-mode variant`);
		}
	}
}
// One caret rule: closed groups point right, open groups point down.
assert.doesNotMatch(css, /__group > summary > svg \{[^}]*rotate\(-90deg\)/);
assert.equal((css.match(/\.shipit-seo-native-panel__group\[open\] > summary > svg \{/g) ?? []).length, 1);
assert.match(css, /\.shipit-seo-native-panel__group\[open\] > summary > svg \{\s*transform: rotate\(90deg\);/);
assert.match(css, /\.shipit-seo-native-panel__group > summary > svg \{\s*transform: rotate\(0deg\);/);
assert.match(editorCss, /\.shipit-seo-native-panel__checks \{\s*display: grid;\s*margin: 0;\s*padding: 0;\s*list-style: none;/, "row lists keep the compact layout");
assert.match(
	editorCss,
	/shipit-seo-native-panel__check\[data-status="info"\][\s\S]*?shipit-seo-native-panel__check-icon[\s\S]*?color:\s*var\(--text-color-kumo-subtle/,
);

// Plugin social metadata is the only writable preview surface.
assert.match(source, /Customize for social/);
assert.match(source, /saveSeoAdminEntrySocial/);
assert.match(source, /Save social text/);
assert.doesNotMatch(source, /Save social metadata|Check saved values<\/Button>/, "each footer action names its save scope");
assert.match(source, /Saving updates published sharing text immediately/);
assert.match(source, /onDraftChange\(\{ title: event.target.value \}\)/);
assert.match(source, /onDraftChange\(\{ description: event.target.value \}\)/);
assert.match(source, /Checking the saved values without submitting changes/);
assert.match(source, /Robots directives apply to the live page as soon as they change/);
assert.match(source, /This entry is published\. Saving or removing a schema here changes its public page immediately\./);
assert.doesNotMatch(source, /Overrides the page title in search results/);
assert.match(source, /Noindex pages also get nofollow, as EmDash does for its own noindex setting\./);
assert.match(source, /<Banner variant="alert" icon=\{bannerIcon\("alert"\)\} title="Schema output is off" description=\{outputNote\} \/>/);
assert.match(source, /Schema output is off in Feature controls, so nothing saved here is added to the page\./);
assert.match(source, /aria-label="Facebook preview"/);
assert.match(source, /aria-label="X preview"/);

// --- Schema tab: one exact entry's own records ------------------------------
assert.match(source, /function EntrySchemaManager/);
assert.match(source, /fetchSeoEntryCustomSchemas/);
assert.match(source, /saveSeoEntryCustomSchema/);
assert.match(source, /removeSeoEntryCustomSchema/);
assert.match(source, /Check current state/);
assert.match(source, /Confirm removing/);
assert.match(source, /the editor's Save and Publish buttons do not save it/);
assert.match(source, /This preview covers this plugin.s output only; EmDash, your theme or other plugins can add JSON-LD\. Check the public page source for full output/);
assert.match(source, /fetchSeoEntrySchemaPreview/);
assert.match(source, /disabledPresets: \[\.\.\.current\]/);
assert.match(source, /jsonLdPlaceholderPaths/);
assert.match(source, /validateEntrySchemaJson/);
// The entry panel never writes or lists schemas through the site-wide configuration routes.
assert.doesNotMatch(source, /fetchSeoAdminConfiguration\(/);
assert.doesNotMatch(source, /saveSeoAdminCustomSchema|deleteSeoAdminCustomSchema/);
assert.match(source, /saveSeoEntryDirectives\(ref, undefined, \{/);
assert.doesNotMatch(
	source,
	/setQueryData\(\[SCORE_QUERY_SCOPE, "directives", ref\]/,
	"directive mutations must refetch instead of replacing the shared cache with an out-of-order response",
);
assert.ok(
	(source.match(/queryKey: \[SCORE_QUERY_SCOPE, "directives", ref\],[\s\S]{0,80}exact: true/g) ?? []).length >= 2,
	"robots and schema directive mutations must both invalidate the exact shared cache key",
);
assert.ok(
	(source.match(/await queryClient\.invalidateQueries\(\{[\s\S]{0,100}queryKey: \[SCORE_QUERY_SCOPE, "directives", ref\]/g) ?? []).length >= 2,
	"directive mutations must remain pending until their shared cache refresh completes",
);
assert.match(
	source,
	/listQuery\.isError \|\| !listedRead \|\| graphsQuery\.isError \|\| directivesQuery\.isError/,
	"schema toggles must not render editable defaults after a directives read failure",
);
assert.ok(
	(source.match(/disabled=\{directivesLoading \|\| directivesLoadError \|\| directivesSaving(?: \|\| !effectiveIndexable)?\}/g) ?? []).length >= 2,
	"robots controls must remain disabled until directives load successfully",
);
assert.match(source, /const switchBusy = presetToggle\.isPending \|\| directivesQuery\.isFetching \|\| switchSettling;/,
	"schema toggles stay busy while their save, a shared directives refetch or the following refresh runs");
assert.match(source, /aria-disabled=\{switchBusy \|\| undefined\}\s+onCheckedChange=\{\(checked\) => \{\s+\/\/[^\n]*\n\s+if \(switchBusy\) return;/,
	"a busy schema toggle ignores changes but keeps keyboard focus");
assert.doesNotMatch(source, /disabled=\{presetToggle\.isPending/, "a schema toggle is never disabled while it saves; that drops focus to the page");
assert.match(source, /<Collapsible\.Root className="shipit-seo-entry-schema__details" open=\{defaultsOpen\} onOpenChange=\{setDefaultsOpen\}>\s*<Collapsible\.DefaultTrigger>Defaults for this entry/,
	"the defaults disclosure keeps its open state through a refresh");
assert.match(
	source,
	/directivesLoading=\{directivesQuery\.isFetching\}/,
	"robots controls must remain disabled while any shared directives refetch is active",
);
assert.match(
	source,
	/Robots directives could not be loaded\.[\s\S]{0,160}onClick=\{onDirectivesRetry\}/,
	"robots load failures must expose an explicit retry without enabling edits",
);
assert.match(source, /Shared schemas not added here/, "shared records that add nothing stay visible with their reason, read-only");

// --- Advanced view: robots mode, directives, canonical ---------------------
assert.match(source, /className="shipit-seo-native-advanced"/);
assert.match(source, /shipit-seo-native-advanced__radio-card/);
assert.match(source, /updateSeo\?\.\(\{ noIndex: false \}\)/);
assert.match(source, /updateSeo\?\.\(\{ noIndex: true \}\)/);
assert.match(source, /resolveSeoDraftIndexability\(preview, editorDraft\)/);
assert.match(source, /Nofollow links/);
assert.match(source, /ADVANCED_ROBOTS_OPTIONS/);
assert.match(source, /onDirectivesSave\(\{ key, value: !robots\[key\] \}\)/);
assert.match(source, /fetchSeoEntryDirectives/);
assert.match(source, /saveSeoEntryDirectives/);
assert.match(source, /Canonical URL/);
assert.match(source, /updateSeo\?\.\(\{ canonical: value \|\| null \}\)/);
assert.match(source, /editorDraft\?\.seo\?\.canonical !== undefined/);
assert.match(
	source,
	/Leave empty to use the public URL\. Override only for intentional\s+consolidation or\s+cross-domain syndication\./,
);
assert.doesNotMatch(source, /XML sitemap/);
assert.match(source, /Canonical validation/);

assert.match(source, /Stored analysis matches this saved entry and its settings/);
assert.match(source, /Open SEO workspace/);
assert.doesNotMatch(source, /hostEditorControlByLabel|setHostEditorControlValue/);

// --- CSS contract (v3 section) ---------------------------------------------
assert.match(css, /\.shipit-seo-native-panel__ring-progress/);
assert.match(css, /\.shipit-seo-native-panel__strip button\[aria-selected="true"\]/);
assert.match(editorCss, /__strip\s*button\[aria-selected="true"\]/);
assert.doesNotMatch(css + editorCss, /__strip[^{]*aria-pressed/);
assert.match(css, /\.shipit-seo-native-panel__keyword-chip\[data-primary\]/);
assert.match(css, /\.shipit-seo-native-panel__keyword-chip\[data-tone="good"\]/);
assert.match(css, /\.shipit-seo-segment-meter/);
assert.match(css, /\.shipit-seo-serp-context__bar/);
assert.match(css, /\.shipit-seo-native-preview__title/);
assert.doesNotMatch(css, /\.shipit-seo-native-preview__title\s*\{[^}]*-webkit-line-clamp/);
assert.doesNotMatch(css, /\.shipit-seo-native-preview__description\s*\{[^}]*-webkit-line-clamp/);
assert.match(css, /\.shipit-seo-entry-schema__presets/);
assert.match(css, /\.shipit-seo-native-advanced__directives-grid/);
assert.match(css, /\.shipit-seo-native-panel__footer/);
assert.match(css, /\.shipit-seo-snippet-dialog__device/);
// No internal scroll trap on the panel views.
assert.doesNotMatch(css, /\.shipit-seo-native-panel__view \{[^}]*max-height: 2\d\dpx/);
assert.match(css, /container-type: inline-size/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /var\(--color-kumo-/);

// --- Saved field ownership notice ------------------------------------------
const ownershipNoticeSource = source.slice(
	source.indexOf("function SavedOwnershipNotice("),
	source.indexOf("function SeoEditorPanel("),
);
assert.doesNotMatch(ownershipNoticeSource, /\bfetch[A-Z]\w*\(|\bsave[A-Z]\w*\(|\bdiscard[A-Z]\w*\(|useQuery|useMutation|\.mutate/, "the notice reads the preview and writes nothing");
assert.doesNotMatch(ownershipNoticeSource, /page title/i, "the title fact never names the theme's page title");
assert.match(ownershipNoticeSource, /href=\{OWNERSHIP_WORKSPACE_URL\}/);
assert.match(source, /const OWNERSHIP_WORKSPACE_URL = `\$\{SEO_WORKSPACE_URL\}\$\{buildSeoAdminSearch\("", "migration"\)\}`;/);
assert.match(ownershipNoticeSource, /record\.keyKind === "id"/);
assert.match(ownershipNoticeSource, /Robots directives EmDash SEO cannot store/);
assert.match(ownershipNoticeSource, /Same value in EmDash SEO and the legacy record/);
assert.match(ownershipNoticeSource, /Saved SEO ownership is unknown/);
// No legacy record does not mean core decides everything: empty core values fall back to templates and defaults.
assert.doesNotMatch(ownershipNoticeSource, /decides all five/);
assert.match(ownershipNoticeSource, /if \(summary\.coreOnly\) \{[\s\S]*?\{draftNote\}[\s\S]*?\}\n\tconst equal/, "the draft caveat is in the no-record branch");
assert.match(ownershipNoticeSource, /\{draftNote\}\n\t\t\t<dl/, "and in the legacy branch");

// The preview is requested afresh on mount, keeps prefix invalidation and the client saved-version check.
assert.match(savedPanelSource, /fetchSeoAdminEntryPreview\(ref, undefined, \{ entryOnly: true, savedVersion, signal \}\)/);
assert.match(savedPanelSource, /retry: false,\n\t\t\/\/ Ownership is current only from a response this panel requested\.\n\t\trefetchOnMount: "always",/,
	"each preview read and each Retry sends one request; a failure is shown, not repeated on its own");
assert.match(savedPanelSource, /queryKey: \[SCORE_QUERY_SCOPE, "preview", input.ref\],/);
assert.match(apiSource, /verifySavedContentVersions\(\[snapshot\]/);
assert.match(savedPanelSource, /fetchedAfterMount: previewQuery\.isFetchedAfterMount,\n\t\t\tfetching: previewQuery\.isFetching \|\| previewRefreshing,\n\t\t\terror: previewRefreshing \? null : previewQuery\.error,/);
assert.match(savedPanelSource, /ownershipRetention\.current = ownershipResolution\.retained;/);
assert.match(source, /key=\{entryRef\(context\.collection, context\.entry\.id\) \+ ":" \+ \(context\.locale \?\? context\.entry\.locale \?\? ""\)\}/,
	"navigation and a requested-locale switch remount the panel, so retained facts start empty");
for (const query of ["fetchSeoAdminSettings", "fetchSeoAnalysisProfile", "fetchSeoContentScore", "fetchSeoAdminEntryPreview"]) {
	const start = savedPanelSource.indexOf(query);
	assert.match(savedPanelSource.slice(start, start + 700), query === "fetchSeoAdminEntryPreview" ? /retry: false,/ : /retry: retryUnlessDenied/,
		`${query} does not retry a permission refusal`);
}

// A permission refusal is explained before any loading or gated branch.
const permissionIndex = savedPanelSource.indexOf("].some(isPermissionDenied)) return (");
assert.ok(permissionIndex > 0);
assert.ok(permissionIndex < savedPanelSource.indexOf("const ownershipNotice"), "403 is handled before independent tools render");
assert.ok(permissionIndex < savedPanelSource.indexOf("const unavailableAnalysis"));
assert.match(savedPanelSource, /\[settingsQuery\.error, assessmentQuery\.error, profileQuery\.error, storedScoreQuery\.error, previewQuery\.error\]\.some\(isPermissionDenied\)/);

// The notice sits outside the settings, profile and score gates, so scoring off or failing still shows it.
const panelBody = savedPanelSource.slice(permissionIndex);
assert.equal((panelBody.match(/advancedNotice=\{ownershipNotice\}/g) ?? []).length, 1, "one ownership notice is passed to the Advanced view");
assert.doesNotMatch(panelBody, /if \(!settingsReady\) return|if \(settingsQuery\.isError && !settingsReady\) return/, "settings loading and failures cannot unmount independent editor tools");
assert.match(panelBody, /const unavailableAnalysis = !score \|\| !assessmentConfigured \?/);
assert.doesNotMatch(savedPanelSource.slice(0, savedPanelSource.indexOf("const ownershipNotice")), /scoringEnabled[^\n]*SavedOwnershipNotice/);
assert.match(css, /\.shipit-seo-field-ownership \{/);
assert.match(css, /\.shipit-seo-field-ownership\[data-state="stale"\]/);

// --- Guarded legacy removal ----------------------------------------------------
const migrationSource = await readFile(new URL("./migration-view.tsx", import.meta.url), "utf8");
assert.match(migrationSource, /fetchSeoAdminMigrationPlan\(target\.conflictPolicy, \[target\.sourceOverrideId\], undefined, \{ snapshot: true \}\)/);
assert.match(migrationSource, /downloadLegacyBackup\(current\.document, legacyBackupFilename\(current\.binding\)\)/, "the delivered document is the download");
assert.match(migrationSource, /updateDiscardState\(markLegacyBackupDownloaded\(current, current\.generation\)\)/, "a download only marks it downloaded");
assert.match(migrationSource, /const binding = legacyDiscardGuard\(current, discardTarget\(item\), current\.generation\);/, "the confirm handler checks the binding again");
assert.match(migrationSource, /const settled = settleLegacyDiscard\(discardStateRef\.current, binding, outcome\);/);
assert.match(migrationSource, /if \(settled\.rebuild && settled\.staleSourceOverrideId\) \{\n\t\t\tawait Promise\.all\(\[rebuildRetainedPlan\(settled\.staleSourceOverrideId, !settled\.current\), overview\]\);/,
	"every removal rebuilds the plan shown before it; a late one keeps an unrelated newer workflow");
assert.match(migrationSource, /const overview = outcome === "removed" \? onOverviewRefresh\(\) : Promise\.resolve\(\);\n\t\tif \(!mounted\.current\) \{/,
	"a removal refreshes the overview even after the view closed");
assert.match(migrationSource, /if \(!options\.keepDiscard\) updateDiscardState\(resetLegacyDiscard\);/);
// While a delete is in flight, the controls that would rebuild the plan or start another workflow wait.
for (const control of [
	/<select value=\{policy\} disabled=\{applying \|\| discardBusy\}/,
	/disabled=\{loadingPlan \|\| applying \|\| discardBusy\} onClick=\{\(\) => void loadPlan\(\)\}/,
	/disabled=\{planCursors\.length < 2 \|\| loadingPlan \|\| applying \|\| discardState\.status === "discarding"\}/,
	/disabled=\{!plan\.hasMore \|\| loadingPlan \|\| applying \|\| discardState\.status === "discarding"\}/,
	/disabled=\{state\?\.status === "preparing" \|\| busy\}/,
	/const selectable = writeAvailable && item\.state === "ready" && !stale && !discardBusy;/,
	/!rollingBack &&\n\t\tdiscardState\.status !== "discarding"/,
	/applyConfirmation === APPLY_CONFIRMATION && !applying &&\n\t\tdiscardState\.status !== "discarding"/,
]) {
	assert.match(migrationSource, control);
}
assert.match(migrationSource, /discardEligibility=\{legacyDiscardEligibility\(item, discardAvailable\)\}/);
assert.match(migrationSource, /const discardAvailable = plan\?\.discardAvailable === true;/, "removal follows the host's discard capability, not writeAvailable");
assert.match(migrationSource, /Guarded removal unavailable on this host/);
assert.match(migrationSource, /irreversible on this site and there is no automatic\s+restore/);
assert.match(migrationSource, /cannot store may stop applying/);
assert.doesNotMatch(migrationSource, /cannot store stop applying/, "removal promises no robots output");
assert.match(migrationSource, /Check the public page after removal to see its actual output\./);
assert.match(migrationSource, /updateDiscardState\(resetLegacyDiscard\);\n\t\tsetLoadingPlan\(true\);/, "every plan load ends the backup and acknowledgement");
assert.match(migrationSource, /disabled=\{!ready\?\.acknowledged\}/);
assert.doesNotMatch(migrationSource, /discardingId|discardLegacy\(/);
assert.match(css, /\.shipit-seo-migration-discard \{/);

const parsedSource = ts.createSourceFile("content-extensions.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function productionDeclaration(name: string): ts.Statement {
	const declaration = parsedSource.statements.find((statement) =>
		(ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
		(ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name)));
	assert.ok(declaration, name);
	return declaration;
}
function compileProduction(text: string, bindings: Record<string, unknown>,
	resolveModule: (name: string) => unknown = createRequire(import.meta.resolve("react")),
): Record<string, unknown> {
	const compiled = ts.transpileModule(text, {
		fileName: "content-extensions.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} };
	new Function("require", "module", "exports", ...Object.keys(bindings), compiled.outputText)(resolveModule, output, output.exports, ...Object.values(bindings));
	return output.exports;
}
// Render the production confirmation and detached guard, rather than a parallel test layout.
let removalRenderer: ts.VariableStatement | undefined;
let detachedConfirmation: ts.ConditionalExpression | undefined;
function findRemovalConfirmation(node: ts.Node): void {
	if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) =>
		ts.isIdentifier(item.name) && item.name.text === "renderRemovalConfirmation")) removalRenderer = node;
	if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression) &&
		ts.isCallExpression(node.expression.condition) && node.expression.condition.expression.getText(parsedSource) === "entrySchemaConfirmationDetached")
		detachedConfirmation = node.expression;
	ts.forEachChild(node, findRemovalConfirmation);
}
findRemovalConfirmation(productionDeclaration("EntrySchemaManager"));
assert.ok(removalRenderer);
assert.ok(detachedConfirmation);
const removalButtons: Array<{ children: string; disabled?: boolean; onClick: () => void }> = [];
const removalProduction = compileProduction(
	"function RemovalProbe({ state, listed, busy, pending, dispatch, remove }) {\n" +
	"const confirming = state.confirming; const published = true; const cancelRemoveRef = { current: null };\n" +
	removalRenderer.getText(parsedSource) + "\nreturn (<>{" + detachedConfirmation.getText(parsedSource) + "}</>);\n}\nmodule.exports = { RemovalProbe };", {
		React, entrySchemaConfirmationDetached, bannerIcon: () => null,
		Banner: ({ title, description }: { title: string; description: string }) => React.createElement("div", null, title, description),
		Button: (props: { children: string; disabled?: boolean; onClick: () => void }) => {
			removalButtons.push(props);
			return React.createElement("button", { disabled: props.disabled, type: "button" }, props.children);
		},
	},
) as { RemovalProbe: React.ComponentType<Record<string, unknown>> };
const capturedRemoval = {
	id: "entry-removal-confirmation", revision: "captured-revision", name: "Captured schema",
	json: "{}", enabled: true, types: [], valid: true, validationError: null, createdAt: "", updatedAt: "",
};
const removalStore = createEntrySchemaPanelStore();
removalStore.dispatch({ type: "confirm-remove", schema: capturedRemoval });
const removalCalls: Array<{ id: string; expectedRevision: string } | null> = [];
const renderDetachedRemoval = (items: unknown[], busy = false) => {
	removalButtons.length = 0;
	return renderToStaticMarkup(React.createElement(removalProduction.RemovalProbe, {
		state: removalStore.get(), listed: { items, outputEnabled: true }, busy, pending: busy ? "remove" : null,
		dispatch: removalStore.dispatch, remove: () => { removalCalls.push(entrySchemaRemovalRequest(removalStore.get())); },
	}));
};
const detachedRemovalHtml = renderDetachedRemoval([]);
assert.match(detachedRemovalHtml, /Confirm removing Captured schema/);
assert.match(detachedRemovalHtml, />Remove<\/button>/);
assert.match(detachedRemovalHtml, />Cancel<\/button>/);
assert.equal(removalButtons.length, 2, "a missing list row retains both actual confirmation controls");
assert.ok(removalButtons.every((button) => button.disabled === false));
removalButtons.find((button) => button.children === "Remove")?.onClick();
assert.deepEqual(removalCalls, [{ id: capturedRemoval.id, expectedRevision: "captured-revision" }], "detached Remove keeps the captured command");
renderDetachedRemoval([], true);
assert.ok(removalButtons.every((button) => button.disabled === true), "a pending removal cannot be replayed or cancelled through the fallback");
assert.equal(renderDetachedRemoval([{ id: capturedRemoval.id }]), "", "the detached branch does not duplicate a confirmation whose row is present");
renderDetachedRemoval([]);
removalButtons.find((button) => button.children === "Cancel")?.onClick();
assert.equal(removalStore.get().confirming, null, "the production fallback Cancel releases the captured confirmation");
assert.equal(renderDetachedRemoval([]), "");

const requireMetadataRuntime = createRequire(import.meta.resolve("react"));
const metadataModule = compileProduction(metadataReviewSource, {}, (name) => {
	if (name === "react/jsx-runtime") return requireMetadataRuntime(name);
	if (name === "./brand-context.ts") return { useSeoBrand };
	assert.equal(name, "./content-extension-model.ts", "the saved review needs only shared ownership labels and the brand");
	return { SEO_OWNERSHIP_SOURCE_LABELS };
}) as {
	SavedMetadataReview: React.ComponentType<{ preview: unknown; field: string | null; previewError?: boolean }>;
	legacyRecordGuidance: (brand: string) => string;
};
const previewModule = compileProduction(previewRendererSource, {}, (name) =>
	name === "@phosphor-icons/react" ? previewIcons : requireMetadataRuntime(name),
) as {
	SearchPreview: React.ComponentType<Record<string, unknown>>;
};
const renderedProduction = compileProduction([
	"snippetDialogDescription", "SavedSnippetReviewNote", "editorAnalysisSource", "sourceResult", "CHECK_ROW_STATUS", "CheckStatusIcon", "checkDisplayLabel",
	"AnalysisCheckRow", "AnalysisCheckGroup", "AnalysisChecklist", "ScorePill",
].map((name) => productionDeclaration(name).getText(parsedSource)).join("\n") +
	"\nmodule.exports = { AnalysisCheckRow, AnalysisCheckGroup, AnalysisChecklist, editorAnalysisSource, ScorePill, SavedSnippetReviewNote, snippetDialogDescription };", {
	React, hasCurrentEditorAnalysis, contentCheckPresentation, contentScoreColumnPresentation, SEO_CHECK_BASIS_LABELS, SEO_OWNERSHIP_SOURCE_LABELS,
	SavedMetadataReview: metadataModule.SavedMetadataReview, ...previewIcons,
}) as {
	AnalysisCheckRow: React.MemoExoticComponent<(props: CheckRowProps) => React.ReactElement>;
	AnalysisCheckGroup: React.ComponentType<{
		group: SeoContentCheckGroup; open: boolean; onOpenChange: (id: string, open: boolean) => void;
		onFix: CheckRowProps["onFix"]; canReviewSnippet: boolean; canAddKeyword: boolean;
	}>;
	AnalysisChecklist: React.ComponentType<Record<string, unknown>>;
	editorAnalysisSource: (score: unknown, analysis: unknown) => unknown;
	ScorePill: React.ComponentType<{ score: Parameters<typeof analysisPresentation>[0] }>;
	SavedSnippetReviewNote: React.ComponentType<{ preview: unknown; field: string | null; previewError?: boolean }>;
	snippetDialogDescription: (view: string, field: string | null) => string;
};
interface CheckRowProps {
	row: SeoCheckRow;
	onFix: (check: SeoContentCheck, origin?: unknown) => void;
	canReviewSnippet: boolean;
	canAddKeyword: boolean;
}
const actionInput: SeoAnalysisInput = {
	ref: "posts:action-owner", collection: "posts", entryId: "action-owner", slug: "bread",
	title: "Fresh bread baked every morning", description: "Fresh bread and pastries are available daily.",
	url: "https://example.invalid/bread", noindex: false, publicationStatus: "draft",
	body: "Fresh bread and pastries are made here every morning.", focusKeyword: "dental implants",
	focusKeywords: ["dental implants", "oral surgery"], assessmentProfile: { profile: "article", version: 1 },
	schemaEnabled: true, schemaPreset: "Article",
};
const noKeywordInput: SeoAnalysisInput = { ...actionInput, focusKeyword: undefined, focusKeywords: [] };
const phoneCutInput: SeoAnalysisInput = { ...actionInput, title: "A complete guide to choosing the right treatment plan for your whole family with dental implants" };
function actionCheck(id: string, input = actionInput): SeoContentCheck {
	const check = analyzeSeoContent(input).checks.find((item) => item.id === id);
	assert.ok(check, id);
	return check;
}
function presentationRows(result: Parameters<typeof contentCheckPresentation>[0]): SeoCheckRow[] {
	return contentCheckPresentation(result).groups.flatMap((group) => group.rows);
}
function actionRow(id: string, input = actionInput): SeoCheckRow {
	const row = presentationRows(analyzeSeoContent(input)).find((item) => item.check.id === id);
	assert.ok(row, id);
	return row;
}
const rowLabel = (check: SeoContentCheck) => check.id === "title" ? "Title present" : check.id === "description" ? "Description present" : check.label;
function escapeGroupText(value: string) { return renderToStaticMarkup(React.createElement(React.Fragment, null, value)); }
const escapeMarkup = escapeGroupText;
const closedGroup = { open: false, onOpenChange: () => undefined, onFix: () => undefined, canReviewSnippet: true, canAddKeyword: true };
const actualGroupScore = { ...analyzeSeoContent(actionInput), freshness: "current" } as Parameters<typeof contentCheckPresentation>[0];
const actualPresentation = contentCheckPresentation(actualGroupScore);
const actualGroups = actualPresentation.groups;
const groupMarkup = renderToStaticMarkup(React.createElement(React.Fragment, null,
	...actualGroups.map((group) => React.createElement(renderedProduction.AnalysisCheckGroup, { ...closedGroup, key: group.id, group })),
));
assert.deepEqual(actualGroups.map((group) => group.label), ["Basic SEO", "Additional", "Search snippet", "Content readability"]);
for (const label of ["Basic SEO", "Additional", "Search snippet", "Content readability"]) assert.ok(groupMarkup.includes(label), label);
assert.equal((groupMarkup.match(/class="shipit-seo-native-panel__group"/g) ?? []).length, 4);
assert.doesNotMatch(groupMarkup, /<details[^>]*\bopen(?:[= >])/);
assert.doesNotMatch(groupMarkup, /Checks by evidence|supporting-checks|group-complete|group-note/);
const visibleRows = actualGroups.reduce((sum, group) => sum + group.rows.length, 0);
assert.equal((groupMarkup.match(/<li class="shipit-seo-native-panel__check"/g) ?? []).length, visibleRows, "rows are list items");
assert.equal((groupMarkup.match(/<ul class="shipit-seo-native-panel__checks"><li class="shipit-seo-native-panel__check"/g) ?? []).length,
	actualGroups.filter((group) => group.rows.length > 0).length, "each group lists its rows in one list");
assert.doesNotMatch(groupMarkup, /<div[^>]*aria-label/, "no generic element carries a name");
const indexingCheck = actualGroupScore.checks.find((check) => check.id === "indexability");
assert.ok(indexingCheck);
assert.ok(!groupMarkup.includes(escapeGroupText(indexingCheck.label)), "the indexing directive is the banner only, never a row");
for (const check of actualGroupScore.checks) if (check.id !== "indexability") assert.ok(groupMarkup.includes(escapeGroupText(check.label)), check.id);
// Header totals are the sums of the group counts, from one function.
for (const key of ["issues", "suggestions", "notChecked", "notApplicable", "passed"] as const) {
	assert.equal(actualPresentation.totals[key], actualGroups.reduce((sum, group) => sum + group.counts[key], 0), key);
}
const shortDensityCheck = actualGroupScore.checks.find((check) => check.id === "keyword-repetition")!;
assert.deepEqual([shortDensityCheck.basis, shortDensityCheck.weight, shortDensityCheck.status], ["not-applicable", 0, "review"],
	"a nine-word body cannot pass or fail a percentage-density check");
assert.match(shortDensityCheck.detail, /not assessed below 100 words/);
assert.deepEqual(actualPresentation.totals, { issues: 5, suggestions: 4, notChecked: 0, notApplicable: 8, passed: 7 });
assert.deepEqual(actualGroups.map((group) => [group.pill.text, group.pill.tone]), [
	["4 issues, 3 suggestions", "poor"], ["1 issue, 1 suggestion", "review"], ["All good", "good"], ["All good", "good"],
], "pills read issues with suggestions, else suggestions, else All good; a plain-text body's heading rows do not apply");
for (const group of actualGroups) assert.ok(groupMarkup.includes(`<span data-tone="${group.pill.tone}">${escapeGroupText(group.pill.text)}</span>`), group.id);
assert.deepEqual(actualGroups[0].rows.map((row) => row.check.id), [
	"content-depth", "keyword-title", "keyword-description", "keyword-content", "keyword-url", "keyword-introduction",
	"secondary-keyword-coverage", "title", "description", "url",
], "Failed, Partly met, Suggestion, Not checked, Passed; heavier first");
const renderedRowOrder = [...groupMarkup.matchAll(/<li class="shipit-seo-native-panel__check"[^>]*>[\s\S]*?<strong title="[^"]*">([^<]*)<\/strong>/g)].map((match) => match[1]);
assert.deepEqual(renderedRowOrder, actualGroups.flatMap((group) => group.rows.map((row) => escapeGroupText(rowLabel(row.check)))),
	"the editor renders the shared row order unchanged");
// Not-applicable rows collapse into one closed list after the rows.
const additionalGroup = actualGroups.find((group) => group.id === "additional")!;
assert.equal(additionalGroup.notApplicableLabel, "4 not applicable");
assert.ok(!additionalGroup.rows.some((row) => row.check.id === "keyword-repetition"), "short-sample density is withdrawn from the visible scored rows");
const additionalMarkup = renderToStaticMarkup(React.createElement(renderedProduction.AnalysisCheckGroup, { ...closedGroup, group: additionalGroup, open: true }));
const notApplicableList = additionalMarkup.match(/<\/ul><details class="shipit-seo-native-panel__not-applicable">([\s\S]*?)<\/details>/)?.[1];
assert.ok(notApplicableList, "a closed not-applicable list follows the rows");
assert.match(notApplicableList, /^<summary><svg[\s\S]*?<\/svg>4 not applicable<\/summary><ul>/);
assert.deepEqual([...notApplicableList.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1]),
	additionalGroup.notApplicable.map((item) => escapeGroupText(item.text)));
assert.deepEqual(additionalGroup.notApplicable.map((item) => item.text), [
	"Image alt text: Image alt checks are turned off.",
	"Internal links, Link text: This body is plain text, which cannot hold links.",
	"Focus keyword repetition: Keyword density is not assessed below 100 words of body text.",
], "rows sharing a reason share one line, while short-sample density keeps its own reason");
assert.doesNotMatch(additionalMarkup, /<details class="shipit-seo-native-panel__not-applicable" open/);
// The default open group comes from the shared presentation; one checklist serves every source.
assert.equal(actualPresentation.defaultOpenGroupId, "basic");
const actualChecklist = renderToStaticMarkup(React.createElement(renderedProduction.AnalysisChecklist, {
	source: renderedProduction.editorAnalysisSource(actualGroupScore, undefined), onFix: () => undefined, canReviewSnippet: true, canAddKeyword: true,
}));
assert.match(actualChecklist, /^<div class="shipit-seo-native-panel__groups" role="group" aria-label="SEO checks">/);
assert.deepEqual([...actualChecklist.matchAll(/<details class="shipit-seo-native-panel__group" data-group-id="([^"]+)"( open="")?/g)].map((match) => [match[1], Boolean(match[2])]),
	[["basic", true], ["additional", false], ["search-snippet", false], ["content-readability", false]]);
assert.match(actualChecklist, /<summary data-group-summary="basic">/, "the group summary is the focus fallback for a removed row");
const passedAdviceInput: SeoAnalysisInput = {
	...actionInput, slug: "first-dental-visit", url: "https://example.invalid/first-dental-visit",
	title: "Planning your first dental visit",
	description: "Plan your first dental visit with a practical appointment checklist.",
	body: "Your first dental visit starts with checking the booking details. Keep the appointment confirmation and plan your journey before leaving home.",
	document: [
		{ _type: "block", style: "h2", children: [{ _type: "span", text: "Preparing for your first dental visit" }] },
		{ _type: "block", style: "normal", children: [{ _type: "span", text: "Your first dental visit starts with checking the booking details. Keep the appointment confirmation and plan your journey before leaving home." }] },
	],
	focusKeyword: "first dental visit", focusKeywords: ["first dental visit"],
	assessmentProfile: { profile: "general", version: 1 },
};
const passedAdviceScore = { ...analyzeSeoContent(passedAdviceInput), freshness: "current" } as Parameters<typeof contentCheckPresentation>[0];
const passedAdvicePresentation = contentCheckPresentation(passedAdviceScore);
const passedAdviceGroup = passedAdvicePresentation.groups.find((group) => group.id === "basic")!;
assert.equal(passedAdviceGroup.scoredCount, 6);
assert.equal(passedAdvicePresentation.defaultOpenGroupId, "additional", "the first group with issues opens");
const passedAdviceMarkup = renderToStaticMarkup(React.createElement(renderedProduction.AnalysisCheckGroup, { ...closedGroup, group: passedAdviceGroup, open: true }));
assert.match(passedAdviceMarkup, /<span data-tone="info">1 suggestion<\/span>/, "a suggestion-only group uses the info tone");
assert.equal((passedAdviceMarkup.match(/class="shipit-seo-native-panel__check-status">Passed<\/small>/g) ?? []).length, 9,
	"every passed visible row reads Passed, including unweighted advice");
assert.equal((passedAdviceMarkup.match(/<li class="shipit-seo-native-panel__check"/g) ?? []).length, 10);
assert.ok(!passedAdviceGroup.rows.some((row) => row.check.id === "focus-keyword"), "a set focus keyword hides its own row");
assert.doesNotMatch(passedAdviceMarkup, />Add keyword</);
assert.deepEqual(passedAdvicePresentation.groups.filter((group) => group.pill.text === "All good").map((group) => group.id), ["search-snippet", "content-readability"]);
const metadataOnlyScore = { ...analyzeSeoContent({ ...actionInput, bodySource: "template", focusKeyword: undefined, focusKeywords: [], image: "https://example.invalid/social.jpg" }), freshness: "current" } as Parameters<typeof analysisPresentation>[0];
const metadataPill = renderToStaticMarkup(React.createElement(renderedProduction.ScorePill, { score: metadataOnlyScore }));
assert.ok(seoAnalysisSummary(metadataOnlyScore).advisorySuggestions > 0);
assert.match(metadataPill, /^<span class="shipit-seo-native-score" role="img" data-tone="neutral"/, "the list pill is named as an image, not a generic span");
assert.match(metadataPill, /aria-label="Partially checked\. 5 weighted checks not checked\./);
assert.match(metadataPill, />-<\/span>$/);
const previousPill = renderToStaticMarkup(React.createElement(renderedProduction.ScorePill, { score: { ...metadataOnlyScore, scoreVersion: SEO_SCORE_VERSION - 1 } }));
assert.match(previousPill, /data-tone="neutral"/);
assert.match(previousPill, /aria-label="Earlier analyzer\. Analyze again\."/);
assert.match(previousPill, />Earlier analyzer<\/span>$/);
assert.doesNotMatch(previousPill, /\d+\/100|Last known SEO score/);
// Render the production header with its one source decision.
const disclosureDeclaration = productionDeclaration("SeoAnalysisDisclosure");
assert.ok(ts.isFunctionDeclaration(disclosureDeclaration) && disclosureDeclaration.body);
const headerProduction = compileProduction([
	"editorAnalysisSource", "sourceResult", "sourceDisplay", "ANALYSIS_SCOPE_TEXT",
	"AnalysisScopeNote", "AnalysisScoreHeader", "BAND_TONES", "AnalysisHeader",
].map((name) => productionDeclaration(name).getText(parsedSource)).join("\n") +
	"\nmodule.exports = { AnalysisHeader, AnalysisScopeNote, editorAnalysisSource };", {
		React, hasCurrentEditorAnalysis, analysisPresentation, contentCheckPresentation, seoScoreDisplay, seoScoreLimitText, summarizeSeoChecks,
		seoCheckTotalsText, SEO_EARLIER_ANALYZER_LABEL,
		Button: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) =>
			React.createElement("button", { type: "button", disabled, onClick }, children),
	},
) as {
	AnalysisHeader: React.ComponentType<Record<string, unknown>>;
	AnalysisScopeNote: React.ComponentType<Record<string, unknown>>;
	editorAnalysisSource: (score: unknown, analysis: unknown) => unknown;
};
function renderHeader(score: unknown, options: { analysis?: unknown; keywordsPending?: boolean; action?: React.ReactNode; onChooseCheckProfile?: () => void } = {}) {
	return renderToStaticMarkup(React.createElement(headerProduction.AnalysisHeader, {
		source: headerProduction.editorAnalysisSource(score, options.analysis), score, keywordsPending: options.keywordsPending ?? false, action: options.action, onChooseCheckProfile: options.onChooseCheckProfile,
	}));
}
function scoreHeaderRegion(html: string) {
	const body = html.indexOf('<div class="shipit-seo-native-panel__body">');
	return body < 0 ? html : html.slice(0, body);
}
function assertSimpleScopeCopy(html: string) {
	assert.doesNotMatch(scoreHeaderRegion(html), /<summary>Score details<\/summary>|<dl|Weighted checks|Weighted result|Outside the score|before limits|points<\/dd>|partly met checks earn|35%|not a Google score|ranking prediction|Basic \/ General content is used because|Browser checks read the verified/,
		"the sidebar gives a short scope note without score mathematics or developer instructions");
}
const genericActionHeader = renderHeader(null, { action: React.createElement("button", { type: "button", "data-generic-header-action": true }, "Optional action") });
assert.match(genericActionHeader.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "", /data-generic-header-action="true">Optional action<\/button>/,
	"the reusable header still supports its explicit action slot");
const missingHeaderHtml = renderHeader(null);
assert.match(missingHeaderHtml, /<div class="shipit-seo-native-panel__ring" data-tone="neutral" data-empty="true" role="img" aria-label="No SEO score"><svg viewBox="0 0 46 46" focusable="false" aria-hidden="true"><circle class="shipit-seo-native-panel__ring-track"[^>]*><\/circle><\/svg><span aria-hidden="true">-<\/span><\/div>/,
	"an empty score keeps the ring track and shows no progress");
assert.match(missingHeaderHtml, /<strong>Not checked<\/strong>/);
assert.doesNotMatch(missingHeaderHtml, /<summary>Score details<\/summary>|<dl|Weighted result/);
assert.doesNotMatch(missingHeaderHtml, /ring-progress|out of 100|Save to calculate|aria-live|role="status"/i);
assert.match(missingHeaderHtml, /^<header class="shipit-seo-native-panel__summary">/, "the header element carries no name");
const unverifiedSelection = selectEditorScore({ sessionScore: null, storedSnapshot: metadataOnlyScore, storedProfileChanged: false });
const mismatchSelection = selectEditorScore({ sessionScore: null, storedSnapshot: { ...metadataOnlyScore, freshness: "stale" }, storedProfileChanged: false });
const profileMismatchSelection = selectEditorScore({ sessionScore: null, storedSnapshot: metadataOnlyScore, storedProfileChanged: true });
const legacySelection = selectEditorScore({ sessionScore: null, storedSnapshot: { ...metadataOnlyScore, scoreVersion: SEO_SCORE_VERSION - 1 }, storedProfileChanged: false });
const verifiedSelection = selectEditorScore({ sessionScore: null, storedSnapshot: metadataOnlyScore, verifiedStoredScore: metadataOnlyScore, storedProfileChanged: false });
const sessionSelection = selectEditorScore({ sessionScore: { ...metadataOnlyScore, persistence: "session" }, storedSnapshot: metadataOnlyScore, storedProfileChanged: false });
for (const [name, selection, label, current] of [
	["unverified", unverifiedSelection, "Saved analysis", false],
	["source mismatch", mismatchSelection, "Analysis needs refreshing", false],
	["profile mismatch", profileMismatchSelection, "Analysis needs refreshing", false],
	["legacy", legacySelection, "Earlier analyzer", false],
	["verified durable", verifiedSelection, "Partially checked", true],
	["verified session", sessionSelection, "Partially checked", true],
] as const) {
	assert.ok(selection.score, name);
	const html = renderHeader(selection.score);
	assertSimpleScopeCopy(html);
	const compactHeader = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
	assert.ok(compactHeader, name);
	assert.ok(compactHeader.includes("<strong>" + label + "</strong>"), name);
	assert.match(compactHeader, /role="img" aria-label="No SEO score"><svg[^>]*><circle class="shipit-seo-native-panel__ring-track"[^>]*><\/circle><\/svg><span aria-hidden="true">-<\/span>/, name);
	assert.doesNotMatch(html, /ring-progress|out of 100|\/100/, name + " never shows a number for a dash, stale or earlier result");
	assert.equal(hasCurrentEditorAnalysis(selection.score), current, name);
	if (current) {
		const totals = contentCheckPresentation(selection.score).totals;
		assert.ok(compactHeader.includes("<span>" + escapeGroupText(seoCheckTotalsText(totals)) + "</span>"), name + " counts come from the shared totals");
		assert.ok(html.includes("Some page content can&#x27;t be checked, so a complete score isn&#x27;t available.") || html.includes("Some page content can&#39;t be checked, so a complete score isn&#39;t available.") || html.includes("Some page content can’t be checked, so a complete score isn’t available."), name + " explains missing page evidence without technical calculations");
		assert.doesNotMatch(compactHeader, /weighted checks? not checked|Weighted/, name + " keeps the calculation out of the compact header");
	} else {
		assert.doesNotMatch(compactHeader, /<span>Current content not checked<\/span>|<span>Analyze again\.<\/span>|weighted checks? not checked/, name + " keeps technical qualifiers out of an unconfirmed header");
		assert.ok(html.includes(name === "legacy"
			? "This saved result is from an earlier version. Save a new analysis in Analysis options."
			: selection.score.freshness === "stale"
				? "This saved result is out of date. Save a new analysis in Analysis options."
				: "This saved result has not been checked against the current content. Save a new analysis in Analysis options."), name + " gives one clear recovery step");
		assert.doesNotMatch(html, /<dl|issues?,|Weighted result/, name + " shows no counts or calculation for an unconfirmed result");
	}
	if (name === "unverified") assert.doesNotMatch(scoreHeaderRegion(html), /needs refreshing|Previous score|Content or settings changed|out of date/,
		"the accessible and visible summary do not invent a stale result");
	if (name === "legacy") assert.doesNotMatch(html, /Analyze this entry|Analyze again\./, "one earlier-version recovery note replaces technical analyzer instructions");
}
// The production analysis slot: the one checklist when a source exists, otherwise the stored-result status.
let renderAnalysisSlot: ts.ArrowFunction | undefined;
function findRenderAnalysis(node: ts.Node): void {
	if (ts.isJsxAttribute(node) && node.name.getText(parsedSource) === "renderAnalysis" && node.initializer && ts.isJsxExpression(node.initializer) &&
		node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
		assert.equal(renderAnalysisSlot, undefined, "one production analysis slot");
		renderAnalysisSlot = node.initializer.expression;
	}
	ts.forEachChild(node, findRenderAnalysis);
}
findRenderAnalysis(disclosureDeclaration);
assert.ok(renderAnalysisSlot);
const findingsProduction = compileProduction(
	"function ScoreFindingsProbe({ score, storedOutOfDate }) {\n" +
	"const source = editorAnalysisSource(score, undefined); const preview = null; const canAddKeyword = false;\n" +
	"const renderLocalAnalysis = undefined; const unavailableContent = null;\n" +
	"const renderAnalysis = " + renderAnalysisSlot.getText(parsedSource) + ";\n" +
	"return (<>{renderAnalysis(() => {})}</>);\n}\nmodule.exports = { ScoreFindingsProbe };", {
		React, SEO_SCORE_VERSION, editorAnalysisSource: renderedProduction.editorAnalysisSource, AnalysisChecklist: renderedProduction.AnalysisChecklist,
	},
) as { ScoreFindingsProbe: React.ComponentType<{
	score: Parameters<typeof analysisPresentation>[0]; storedOutOfDate: boolean;
}> };
const staleSessionSelection = selectEditorScore({
	sessionScore: { ...metadataOnlyScore, persistence: "session", freshness: "stale" },
	storedSnapshot: null, storedProfileChanged: false,
});
assert.equal(staleSessionSelection.score?.persistence, "session");
assert.equal(staleSessionSelection.score?.freshness, "stale", "existing session demotion is preserved");
for (const [name, selection, current, message] of [
	["ordinary unverified snapshot", unverifiedSelection, false, "This analysis has not been checked against the saved content and current settings."],
	["stale session without a stored result", staleSessionSelection, false, "This analysis has not been checked against the saved content and current settings."],
	["known stored mismatch", mismatchSelection, false, "Content or settings changed since the previous analysis."],
	["earlier analyzer", legacySelection, false, "<p>Saved with an earlier analyzer.</p><p>Use Save analysis in Analysis options to check this version."],
	["verified durable result", verifiedSelection, true, null],
] as const) {
	assert.ok(selection.score, name);
	const html = renderToStaticMarkup(React.createElement(findingsProduction.ScoreFindingsProbe, {
		score: selection.score, storedOutOfDate: selection.storedOutOfDate,
	}));
	assert.equal(html.includes('aria-label="SEO checks"'), current, name);
	assert.equal(html.includes('role="status"'), !current, name);
	if (current) continue;
	assert.ok(html.includes(message), name);
	assert.equal(html.match(/Use Save analysis in Analysis options/g)?.length, 1, name + " asks for one deliberate saved analysis");
	assert.doesNotMatch(html, /<input|<textarea|<form|class="shipit-seo-native-panel__check"/,
		"unconfirmed evidence exposes neither editable findings nor a current checklist");
	if (selection.score.persistence === "session") {
		assert.doesNotMatch(html, /The saved analysis|Previous results remain in your score history/,
			"an unconfirmed session result never claims to be a stored result or retained history");
	} else {
		assert.ok(html.includes("Previous results remain in your score history"), "ordinary stored history stays available");
	}
}
const rowDefaults: Omit<CheckRowProps, "row"> = { onFix: () => undefined, canReviewSnippet: true, canAddKeyword: true };
function rowMarkup(row: SeoCheckRow, options: Partial<Omit<CheckRowProps, "row">> = {}) {
	return renderToStaticMarkup(React.createElement(renderedProduction.AnalysisCheckRow, { ...rowDefaults, ...options, row }));
}
for (const [id, label, verb, input] of [
	["title", "Title present", "Edit title", { ...actionInput, title: "A very long saved title. ".repeat(12) }],
	["description", "Description present", "Edit description", { ...actionInput, description: "Short." }],
] as const) {
	const presence = actionRow(id, input);
	assert.equal(presence.check.status, "pass");
	assert.equal(presence.word, "Passed");
	const html = rowMarkup(presence);
	assert.ok(html.includes(`<strong title="${label}">${label}</strong>`), "a passed presence check states its narrow scope");
	assert.match(html, /check-status">Passed</);
	assert.doesNotMatch(html, /<button/, "a passed row offers no action");
	const missing = actionRow(id, { ...input, [id]: "" });
	assert.equal(missing.word, "Failed");
	const missingHtml = rowMarkup(missing);
	assert.ok(missingHtml.includes(`<strong title="${label}">${label}</strong>`));
	assert.ok(missingHtml.includes(`aria-label="${verb}: ${label}">${verb}</button>`), "the accessible action names its verb and the same presence check");
	const length = actionCheck(`${id}-display-length`, input);
	assert.equal(length.label, id === "title" ? "Title fit" : "Description fit");
	assert.equal(length.basis, "heuristic");
	assert.ok(rowMarkup(actionRow(`${id}-display-length`, input)).includes(`<strong title="${length.label}">${length.label}</strong>`), "snippet fit stays a separate advice row");
}
const compactRow = actionRow("keyword-description");
assert.equal(compactRow.word, "Failed");
const compactControl = rowMarkup(compactRow);
assert.match(compactControl, /^<li class="shipit-seo-native-panel__check" data-status="fail" data-kind="failed" data-basis="heuristic">/);
assert.match(compactControl, /<details class="shipit-seo-native-panel__check-details">/,
	"check explanations start in a closed native disclosure");
assert.doesNotMatch(compactControl, /<details[^>]*\bopen(?:[= >])/);
const compactSummary = compactControl.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1];
assert.ok(compactSummary);
assert.doesNotMatch(compactSummary, /<p(?:\s|>)|<button/);
assert.match(compactControl, /<\/details><button/, "the owner action is a sibling outside summary");
assert.match(compactControl, /aria-label="Edit description: Focus keyword in description">Edit description<\/button><\/li>$/, "one inline action on the row's line");
assert.match(compactSummary, /Focus keyword in description/);
assert.match(compactSummary, /<small class="shipit-seo-native-panel__check-status">Failed<\/small>/);
const expandedCopy = compactControl.match(/<div class="shipit-seo-native-panel__check-copy">([\s\S]*?)<\/div><\/details>/)?.[1];
assert.ok(expandedCopy);
const compactCheck = compactRow.check;
// Line 1 is the icon, label and status word; line 2 is the finding, readable without expanding.
assert.match(compactSummary, /^<span class="shipit-seo-native-panel__check-icon">[\s\S]*?<\/span><span class="shipit-seo-native-panel__check-summary"><span class="shipit-seo-native-panel__check-heading"><strong title="Focus keyword in description">Focus keyword in description<\/strong><small class="shipit-seo-native-panel__check-status">Failed<\/small><\/span><span class="shipit-seo-native-panel__check-detail">/);
assert.ok(compactSummary.includes(`<span class="shipit-seo-native-panel__check-detail">${escapeMarkup(compactCheck.detail)}</span>`), "the finding is the summary's second line");
assert.ok(!expandedCopy.includes(escapeMarkup(compactCheck.detail)), "the expansion does not repeat the finding");
for (const value of [compactCheck.recommendation, compactCheck.evidence.source, compactCheck.limitation!]) {
	assert.ok(expandedCopy.includes(escapeMarkup(value)), value);
	assert.ok(!compactSummary.includes(escapeMarkup(value)), "recommendation, basis and limitation stay in the expansion");
}
assert.match(expandedCopy, /data-basis="heuristic">Heuristic guidance/);
const legacyRow = presentationRows({ ...analyzeSeoContent({ ...actionInput, title: "Dental implants explained" }), scoreVersion: SEO_SCORE_VERSION - 1 })
	.find((row) => row.check.id === "keyword-title")!;
const collapsedCases: Array<{ row: SeoCheckRow; word: string; basis: keyof typeof SEO_CHECK_BASIS_LABELS; status: string }> = [
	{ row: actionRow("keyword-title", { ...actionInput, title: "Dental implants explained" }), word: "Passed", basis: "heuristic", status: "pass" },
	{ row: actionRow("keyword-description"), word: "Failed", basis: "heuristic", status: "fail" },
	{ row: actionRow("social-image"), word: "Partly met", basis: "measured", status: "review" },
	{ row: actionRow("focus-keyword", noKeywordInput), word: "Suggestion", basis: "measured", status: "suggestion" },
	{ row: actionRow("keyword-title-position", phoneCutInput), word: "Suggestion", basis: "heuristic", status: "suggestion" },
	{ row: actionRow("keyword-content", { ...actionInput, bodySource: "template" }), word: "Not checked", basis: "unavailable", status: "info" },
	{ row: legacyRow, word: "Earlier result", basis: "legacy", status: "info" },
];
for (const { row, word, basis, status } of collapsedCases) {
	assert.equal(row.word, word, row.check.id);
	const html = rowMarkup(row);
	assert.ok(html.startsWith(`<li class="shipit-seo-native-panel__check" data-status="${status}" data-kind="${row.kind}" data-basis="${basis}">`), row.check.id);
	const summary = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1];
	assert.ok(summary);
	assert.match(summary, new RegExp('check-status">' + word + "<"));
	assert.ok(summary.includes(escapeMarkup(rowLabel(row.check))));
	assert.doesNotMatch(summary, /<button|tabindex=|role="button"/);
	assert.doesNotMatch(html, /<details[^>]*\bopen(?:[= >])/);
	assert.ok(html.includes(escapeMarkup(row.check.detail)), row.check.id + " retains detail");
	assert.ok(html.includes(SEO_CHECK_BASIS_LABELS[basis]), row.check.id + " retains its evidence basis");
	assert.equal(html.includes("shipit-seo-native-panel__check-recommendation"), word !== "Passed" && word !== "Earlier result",
		row.check.id + " shows its recommendation unless it passed, including Not checked rows");
}
for (const input of [{ ...actionInput, publicationStatus: "published", noindex: true, noindexSources: ["entry-seo"] }, { ...actionInput, publicationStatus: "published", noindex: false }]) {
	assert.ok(!presentationRows(analyzeSeoContent(input as SeoAnalysisInput)).some((row) => row.check.id === "indexability"), "the indexing directive is never a row");
}
const longLabelRow: SeoCheckRow = { ...compactRow, check: { ...compactCheck, label: "Saved description with a very long localized label İstanbul résumé العربية" } };
assert.ok(rowMarkup(longLabelRow).includes(escapeMarkup(longLabelRow.check.label)), "long labels remain complete for wrapping");
assert.match(css, /check-details > summary[\s\S]*?minmax\(0, 1fr\)/);
assert.match(css, /check-details > summary:focus-visible/);
assert.match(css, /check-heading[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere/);
assert.match(editorCss, /check-heading > strong/);
assert.match(editorCss, /check\[data-basis="legacy"\][\s\S]*?check-icon[\s\S]*?color: var\(--text-color-kumo-subtle/,
	"historical rows keep a neutral icon even when their recorded status passed");
assert.match(editorCss, /check > button[\s\S]*?min-height: 36px/);
assert.doesNotMatch(css, /__group(?:\[open\])? summary/, "group styles cannot target nested row summaries");
assert.doesNotMatch(css, /__group(?:\[open\])? > summary svg/, "group caret styles target only direct icons");
assert.match(css, /check-details\[open\] > summary > \.shipit-seo-native-panel__check-caret/);
// Rows: the caret leads every row and the open details span the full row. A wide panel puts the
// action at the end of line 1; a narrow one puts it at the row end below the finding.
/** The last rule for exactly this selector, which wins the cascade among equal selectors. */
const cssRule = (sheet: string, selector: string) => {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
	const match = [...sheet.matchAll(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].at(-1);
	assert.ok(match, selector);
	return match[1]!;
};
const narrowRowsPrelude = "@container shipit-seo-panel (max-width: 460px) {";
assert.equal(editorCss.split(narrowRowsPrelude).length, 2, "one narrow-panel row block");
const narrowRowsStart = editorCss.indexOf(narrowRowsPrelude) + narrowRowsPrelude.length;
const narrowRowsEnd = editorCss.indexOf("\n}\n", narrowRowsStart);
const narrowRows = editorCss.slice(narrowRowsStart, narrowRowsEnd);
const wideEditorCss = editorCss.slice(0, narrowRowsStart) + editorCss.slice(narrowRowsEnd);
assert.match(cssRule(wideEditorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check"), /position: relative;\s*display: block;/,
	"the details are not confined to a grid column beside the action");
assert.match(cssRule(wideEditorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check-details > summary"),
	/grid-template-columns: 12px 16px minmax\(0, 1fr\) auto;/);
assert.match(cssRule(wideEditorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check-details > summary > .shipit-seo-native-panel__check-caret"),
	/grid-column: 1;\s*grid-row: 1;/, "the caret leads every row, with or without an action");
assert.match(cssRule(wideEditorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check-action-space"), /grid-column: 4;[\s\S]*visibility: hidden;/);
assert.match(cssRule(wideEditorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check > button"),
	/position: absolute;\s*inset-block-start: 6px;\s*inset-inline-end: 10px;/);
// The narrow block follows the wide rules, so it wins the cascade at equal specificity.
const wideActionRule = editorCss.indexOf(".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check > button {\n  position: absolute;");
assert.ok(wideActionRule >= 0 && narrowRowsStart > wideActionRule);
assert.match(cssRule(narrowRows, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check-details > summary"),
	/^\s*grid-template-columns: 12px 16px minmax\(0, 1fr\);\s*$/, "line 1 gives the label and status word the whole width");
assert.match(cssRule(narrowRows, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check-action-space"), /^\s*display: none;\s*$/);
assert.match(cssRule(narrowRows, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__check > button"),
	/^\s*position: static;\s*display: block;\s*width: fit-content;\s*margin: 0 2px 2px auto;\s*$/, "the action sits at the row end below the finding");
assert.doesNotMatch(narrowRows, /check-heading|check-status|ellipsis|\border:|tabindex/, "the narrow block neither shortens line 1 nor reorders focus");
assert.match(compactSummary, /<span class="shipit-seo-native-panel__check-action-space" aria-hidden="true">Edit description<\/span>$/,
	"the summary reserves the action's width with a hidden copy of its label");
assert.ok(!rowMarkup(actionRow("keyword-title", { ...actionInput, title: "Dental implants explained" })).includes("check-action-space"),
	"a row without an action reserves nothing");
// Small analysis text reads at 11px or more.
assert.match(cssRule(editorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__group > summary > span"), /font-size: 11px;/);
assert.match(cssRule(css, ".shipit-seo-native-panel__check-status"), /font-size: 11px;/);
assert.match(cssRule(css, ".shipit-seo-native-panel__basis"), /font-size: 11px;/);
// The ring keeps its track without a score, and three digits stay clear of the stroke.
assert.match(cssRule(css, '.shipit-seo-native-panel__ring[data-digits="3"] > span'), /font-size: 12px;/);
// Dark surfaces get a dark default border; the host defines no such token.
assert.match(editorCss, /:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \{\s*--border-color-kumo-default: var\(--color-kumo-line, #3a3a3a\);\s*\}/);
// The selected Analysis tab and pressed device buttons show a keyboard focus ring.
assert.match(cssRule(editorCss, ".shipit-seo-native-panel--sidebar .shipit-seo-native-panel__strip button:focus-visible,\n.shipit-seo-snippet-dialog__device button:focus-visible"),
	/outline: 2px solid var\(--border-color-kumo-focus, #0b74de\);/);
// Keyword emphasis paints bold without changing the advances the fit measured.
assert.match(cssRule(editorCss, ".shipit-seo-native-preview-model [data-preview-emphasis]"), /font-weight: inherit;\s*-webkit-text-stroke: 0\.04em currentColor;/);

// The status word stays on line 1: the heading never wraps, the closed label is shortened and the word keeps its width.
assert.doesNotMatch(cssRule(css, ".shipit-seo-native-panel__check-heading"), /flex-wrap: wrap/);
assert.match(cssRule(css, ".shipit-seo-native-panel__check-heading > strong"), /overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap;/);
assert.match(cssRule(css, ".shipit-seo-native-panel__check-status"), /flex: none;[\s\S]*white-space: nowrap;/);
assert.match(cssRule(css, ".shipit-seo-native-panel__check-details[open] .shipit-seo-native-panel__check-heading > strong"), /white-space: normal;/,
	"an open row shows the whole label");
// Each row with a target offers one verb on its line; its accessible name is "{verb}: {label}".
for (const [id, verb, input] of [
	["keyword-title", "Edit title", actionInput],
	["keyword-description", "Edit description", actionInput],
	["keyword-url", "Review URL", actionInput],
	["keyword-title-position", "Edit title", phoneCutInput],
	["title-display-length", "Edit title", { ...actionInput, title: "A very long saved title. ".repeat(12) }],
	["social-image", "Edit image", actionInput],
	["title", "Edit title", { ...actionInput, title: "" }],
	["url", "Open Advanced", { ...actionInput, url: "ftp://example.invalid/bread" }],
	["focus-keyword", "Add keyword", noKeywordInput],
] as const) {
	const row = actionRow(id, input);
	assert.equal(row.action?.verb, verb, id);
	const html = rowMarkup(row);
	assert.ok(html.includes(`<button type="button" aria-label="${verb}: ${escapeMarkup(rowLabel(row.check))}">${verb}</button>`), id);
	assert.doesNotMatch(html, />(?:Fix|Review)<\/button>/, id);
	assert.equal(rowMarkup(row, { canReviewSnippet: false }).includes("<button"), row.action?.target === "keyword" || row.action?.target === "advanced",
		id + ": without a loaded preview only the keyword field and Advanced can take focus");
	assert.equal(rowMarkup(row, { canAddKeyword: false }).includes("<button"), row.action?.target !== "keyword",
		id + ": a hidden or disabled keyword editor offers no Add keyword");
}
for (const id of ["keyword-content", "keyword-introduction", "secondary-keyword-coverage", "content-depth"]) {
	const row = actionRow(id);
	assert.equal(row.action, null, id);
	assert.doesNotMatch(rowMarkup(row), /<button/, id + ": body rows have no editor target");
}
const keywordTitleResult = analyzeSeoContent(actionInput);
const passedKeywordTitle = presentationRows({ ...keywordTitleResult, checks: keywordTitleResult.checks.map((check) =>
	check.id === "keyword-title" ? { ...check, status: "pass" as const } : check) }).find((row) => row.check.id === "keyword-title")!;
assert.equal(passedKeywordTitle.action, null);
assert.doesNotMatch(rowMarkup(passedKeywordTitle), /<button/, "a passed row offers no action");
assert.equal(presentationRows({ ...keywordTitleResult, checks: keywordTitleResult.checks.map((check) =>
	check.id === "keyword-title" ? { ...check, basis: "not-applicable" as const } : check) }).some((row) => row.check.id === "keyword-title"), false,
	"a not-applicable check is listed, never a row with an action");
assert.match(source, /canReviewSnippet=\{Boolean\(preview\)\}/);

let fixedCheck: { check: SeoContentCheck; origin: unknown } | null = null;
const clickableRow = actionRow("keyword-description");
const rowElement = renderedProduction.AnalysisCheckRow.type({
	row: clickableRow, canReviewSnippet: true, canAddKeyword: true, onFix: (check, origin) => { fixedCheck = { check, origin }; },
});
function findButton(element: React.ReactNode): React.ReactElement<{ onClick: (event?: unknown) => void }> | null {
	let found: React.ReactElement<{ onClick: (event?: unknown) => void }> | null = null;
	React.Children.forEach(element, (child) => {
		if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
		if (child.type === "button") found = child as React.ReactElement<{ onClick: (event?: unknown) => void }>;
		else found ??= findButton(child.props.children);
	});
	return found;
}
const reviewButton = findButton(rowElement);
assert.ok(reviewButton);
reviewButton.props.onClick();
assert.deepEqual(fixedCheck, { check: clickableRow.check, origin: null }, "the action hands off the exact check without changing it");
const originButton = { focus: () => undefined };
reviewButton.props.onClick({ currentTarget: originButton });
assert.equal((fixedCheck as { origin: unknown } | null)?.origin, originButton, "the clicked button is kept so focus can return to it");

const reviewSavedTitle = "A complete saved title suggestion";
const reviewSavedDescription = "The full saved description remains readable outside the approximate card. ".repeat(7).trim();
const reviewPreview = {
	content: { ref: "posts:action-owner", entryId: "action-owner", collection: "posts",
		collectionLabel: "Posts", title: "Saved content title", slug: "checked-entry-slug" },
	search: {
		title: reviewSavedTitle,
		description: reviewSavedDescription,
		url: "https://canonical.invalid/distinct-preview-address/",
		titleLength: [...reviewSavedTitle].length, descriptionLength: [...reviewSavedDescription].length, publishedAt: null,
	},
	indexable: true,
	sources: { title: "core-seo", description: "template", canonical: "core-seo",
		socialTitle: "content", socialDescription: "template", image: "site-default" },
};
function noteMarkup(field: string | null,
	sources: Pick<typeof reviewPreview.sources, "title" | "description"> = reviewPreview.sources, previewError = false,
) {
	return renderToStaticMarkup(React.createElement(renderedProduction.SavedSnippetReviewNote, {
		preview: { ...reviewPreview, sources: { ...reviewPreview.sources, ...sources } }, field, previewError,
	}));
}
assert.deepEqual({
	urlDistinction: /resolved URL[\s\S]*canonical[\s\S]*card URL may differ/.test(noteMarkup("slug")),
	contentTitleOwner: /Title/.test(noteMarkup("title", { title: "content", description: "content" })),
	contentDescriptionOwner: /Excerpt[\s\S]*body/.test(noteMarkup("description", { title: "content", description: "content" })),
	templateSharedScope: /other entries/.test(noteMarkup("description")),
	dynamicDialogPurpose: /<Dialog.Description[^>]*>\s*\{snippetDialogDescription\(dialogView, reviewField\)\}/.test(source),
}, {
	urlDistinction: true, contentTitleOwner: true, contentDescriptionOwner: true,
	templateSharedScope: true, dynamicDialogPurpose: true,
}, "review guidance names the owner and URL boundary before the card");
assert.match(noteMarkup("title"), /Edit SEO Title under Settings &gt; SEO/);
assert.match(noteMarkup("title"), /Source: EmDash SEO/);
assert.match(noteMarkup("title"), /where enabled for this content type/);
assert.match(noteMarkup("title"), /site template controls the served page title/);
assert.match(noteMarkup("description"), /Review SEO &gt; Templates/, "without a readable brand the hint names the neutral label");
assert.match(renderToStaticMarkup(React.createElement(SeoBrandProvider, { value: { kind: "configured", name: "Acme SEO" } },
	React.createElement(renderedProduction.SavedSnippetReviewNote, { preview: reviewPreview, field: "description" }))), /Review Acme SEO &gt; Templates/);
assert.match(noteMarkup("description"), /Source: Metadata template/);
assert.doesNotMatch(noteMarkup("description"), /Edit Meta Description under Settings/);
assert.match(noteMarkup("description", { title: "core-seo", description: "core-seo" }), /Edit Meta Description under Settings &gt; SEO/);
assert.match(noteMarkup("title", { title: "legacy-override", description: "content" }), /saved SEO ownership for this entry and SEO &gt; Settings &gt; Migration/);
assert.match(noteMarkup("description", { title: "legacy-override", description: "content" }), /Excerpt, Summary or Description.*body/);
const slugNote = noteMarkup("slug");
assert.match(slugNote, /Settings &gt; URL &amp; language/);
assert.match(slugNote, /resolved URL when the slug is blank.*canonical/);
assert.match(slugNote, /custom public route.*route configuration change/);
assert.match(slugNote, /card URL may differ from the checked slug/);
assert.doesNotMatch(slugNote, /checked-entry-slug/,
	"the displayed resolved URL is not presented as the keyword check's saved slug");
assert.ok(slugNote.includes(escapeMarkup(reviewPreview.search.url)));
for (const owner of ["content", "generated"]) {
	assert.match(noteMarkup("title", { title: owner, description: owner }), /Title or configured title field/);
	assert.match(noteMarkup("description", { title: owner, description: owner }), /Excerpt, Summary or Description.*body/);
}
for (const field of ["title", "description"]) {
	const note = noteMarkup(field, { title: "template", description: "template" });
	assert.match(note, /other entries of this type/);
	assert.match(note, /entry override under Settings &gt; SEO, where enabled/);
	assert.match(note, new RegExp("resolved " + (field === "title" ? "title suggestion" : "description")));
}
const reviewDescription = renderedProduction.snippetDialogDescription;
assert.match(reviewDescription("general", "title"), /Edit this entry.*SEO title.*preview/);
assert.match(reviewDescription("general", "description"), /Edit this entry.*meta description.*preview/);
assert.match(reviewDescription("general", "slug"), /card URL may be canonical.*checked slug/);
assert.match(reviewDescription("general", null), /Edit SEO and sharing metadata/);
assert.match(reviewDescription("social", "title"), /Edit SEO and sharing metadata/);
const frameProduction = compileProduction([
	"SearchSnippetFrame", "SerpContext",
].map((name) => productionDeclaration(name).getText(parsedSource)).join("\n") +
	"\nmodule.exports = { SearchSnippetFrame, SerpContext };", {
	React, buildSavedSearchPreviewModel, buildNativeSeoSearchPreview, ResolvedSearchPreview: previewModule.SearchPreview, seoKeywordMatchRanges,
	seoSnippetDatePrefix: snippetFitModule.seoSnippetDatePrefix, ...previewIcons,
}) as {
	SearchSnippetFrame: React.ComponentType<Record<string, unknown>>;
	SerpContext: React.ComponentType<Record<string, unknown>>;
};
// The primary keyword is bold in the description through the analyzer's matcher; text and names do not change.
const emphasisPreview = { ...reviewPreview, search: { ...reviewPreview.search, title: "Dental implants explained",
	description: "Dental implants replace missing teeth. Ask about oral surgery and dental implants today." } };
const emphasisMarkup = (keyword: string, device = "mobile", resultPage = false) => renderToStaticMarkup(React.createElement(frameProduction.SearchSnippetFrame,
	{ preview: emphasisPreview, device, locale: "en", keyword, resultPage, descriptionDisplay: resultPage ? "external" : "compact" }));
const boldText = (html: string) => [...html.matchAll(/<strong data-preview-emphasis="true">([^<]*)<\/strong>/g)].map((match) => match[1]).join(" ");
for (const [device, resultPage] of [["mobile", false], ["desktop", false], ["desktop", true]] as const) {
	const html = emphasisMarkup("dental implants", device, resultPage);
	assert.equal(boldText(html), "Dental implants dental implants", `${device} ${resultPage ? "result page" : "card"}: both description matches are bold`);
	const titleLines = [...html.matchAll(/<div data-preview-line="title"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => match[1]).join("");
	assert.doesNotMatch(titleLines, /<strong/, "the title is never bold");
	assert.equal(html.replace(/<strong data-preview-emphasis="true">([^<]*)<\/strong>/g, "$1"), emphasisMarkup("", device, resultPage), "emphasis changes no text, order or accessible name");
}
assert.equal(boldText(emphasisMarkup("")), "", "no keyword, no emphasis");
assert.equal(boldText(emphasisMarkup("oral surgery")), "oral surgery", "the frame bolds only the keyword it is given");
assert.match(source, /serpQuery=\{keywordsValue\[0\] \?\? ""\}/, "the previews receive the primary keyword only");
assert.equal((source.match(/<SearchSnippetFrame\b[^>]*keyword=\{serpQuery\}/g) ?? []).length, 3, "the sidebar card and both dialog cards emphasise the same keyword");
const nativeFieldNodes: Array<{ tag: string; props: Record<string, any> }> = [];
function NativeProbeButton({ variant: _variant, children, ...props }: Record<string, any>) {
	return React.createElement("button", props, children);
}
const nativeFieldJsx = requireMetadataRuntime("react/jsx-runtime") as typeof import("react/jsx-runtime");
const observeNativeField = (factory: typeof nativeFieldJsx.jsx) => (...args: Parameters<typeof nativeFieldJsx.jsx>) => {
	const [type, props] = args;
	const tag = typeof type === "string" ? type : type === NativeProbeButton ? "button" : null;
	if (tag && props && typeof props === "object" && !Array.isArray(props)) nativeFieldNodes.push({ tag, props: props as Record<string, any> });
	return factory(...args);
};
const nativeFieldsProduction = compileProduction(nativeSeoFieldsSource, {}, (name) => {
	if (name === "react") return React;
	if (name === "react/jsx-runtime") return { ...nativeFieldJsx, jsx: observeNativeField(nativeFieldJsx.jsx), jsxs: observeNativeField(nativeFieldJsx.jsxs) };
	if (name === "@cloudflare/kumo/components/button") return { Button: NativeProbeButton };
	if (name === "@emdash-cms/admin") return { MediaPickerModal: () => null };
	if (name === "@phosphor-icons/react") return previewIcons;
	if (name === "./native-seo-editor-state.ts") return nativeSeoState;
	if (name === "../snippet-fit.ts") return snippetFitModule;
	if (name === "./native-seo-image-fallback.ts") return nativeSeoImageFallback;
	assert.equal(name, "./local-media.ts", "General fields use only their existing model and public leaf boundaries");
	return { selectedLocalMediaUrl };
}) as {
	NativeSeoTextFields: React.ComponentType<{ controller: NativeSeoEditorController; preview: unknown }>;
	NativeSeoSaveStatus: React.ComponentType<{ controller: NativeSeoEditorController }>;
	NativeSeoRecoveryActions: React.ComponentType<{ controller: NativeSeoEditorController }>;
	NativeSeoSaveButton: React.ComponentType<{ controller: NativeSeoEditorController; primary: boolean }>;
	nativeSeoHasChanges: (controller: NativeSeoEditorController) => boolean;
	nativeSeoSaveOutstanding: (controller: NativeSeoEditorController) => boolean;
};
let generalPanelElement: ts.JsxElement | undefined;
function findGeneralPanel(node: ts.Node): void {
	if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((property) =>
		ts.isJsxAttribute(property) && property.name.getText(parsedSource) === "id" &&
		property.initializer?.getText(parsedSource) === '{dialogTabId + "-general-panel"}')) {
		assert.equal(generalPanelElement, undefined, "there is one General panel");
		generalPanelElement = node;
	}
	ts.forEachChild(node, findGeneralPanel);
}
findGeneralPanel(productionDeclaration("SearchPreview"));
assert.ok(generalPanelElement);
const generalReviewCalls: Array<{ preview: unknown; field: string | null; previewError?: boolean }> = [];
const generalFrameCalls: Array<Record<string, unknown>> = [];
let generalSocialWrites = 0;
type GeneralPanelProps = {
	preview: typeof reviewPreview; reviewField: string | null; serpContext: boolean; previewError: boolean;
	nativeEditor: NativeSeoEditorController;
};
const generalProduction = compileProduction(
	"function GeneralPanelProbe({ preview, reviewField, serpContext, previewError, nativeEditor }) {\n" +
	'const dialogTabId = "review-probe"; const dialogView = "general";\n' +
	'const device = "mobile"; const locale = "nl"; const serpQuery = "dental"; const previewRetryNotice = null; const brand = { name: "Acme SEO" };\n' +
	"return (" + generalPanelElement.getText(parsedSource) + ");\n}\nmodule.exports = { GeneralPanelProbe };", {
	React, NativeSeoTextFields: nativeFieldsProduction.NativeSeoTextFields, seoSnippetDatePrefix: snippetFitModule.seoSnippetDatePrefix,
	legacyRecordGuidance: metadataModule.legacyRecordGuidance,
	onSocialSave: () => { generalSocialWrites += 1; },
	SavedSnippetReviewNote: (props: { preview: unknown; field: string | null; previewError?: boolean }) => {
		generalReviewCalls.push(props);
		return React.createElement("div", { "data-general-review-probe": true },
			React.createElement(renderedProduction.SavedSnippetReviewNote, props));
	},
	SearchSnippetFrame: (props: Record<string, unknown>) => {
		generalFrameCalls.push(props);
		return React.createElement(frameProduction.SearchSnippetFrame, props);
	},
	SerpContext: frameProduction.SerpContext,
}) as { GeneralPanelProbe: React.ComponentType<GeneralPanelProps> };
const generalNativeTarget: nativeSeoState.NativeSeoTarget = {
	principal: { id: "general-editor", role: 40 }, collection: "posts", entryId: "action-owner", locale: "nl",
};
function generalNativeEditor(values: nativeSeoState.NativeSeoValues) {
	const writes: ReturnType<typeof nativeSeoState.nativeSeoWriteInput>[] = [];
	const controller: NativeSeoEditorController = {
		state: nativeSeoState.createNativeSeoEditorState(generalNativeTarget, { target: generalNativeTarget, revision: "general-revision", values }),
		loading: false, unavailable: false, allowedFields: ["title", "description", "image"],
		change: (patch) => { controller.state = nativeSeoState.updateNativeSeoDraft(controller.state!, patch); },
		save: () => {
			const started = nativeSeoState.beginNativeSeoSave(controller.state!);
			controller.state = started.state;
			if (started.attempt) writes.push(nativeSeoState.nativeSeoWriteInput(started.attempt));
		},
		read: () => {}, review: () => {},
		discard: () => { controller.state = nativeSeoState.discardNativeSeoDraft(controller.state!); },
	};
	return { controller, writes };
}
function renderGeneral(props: GeneralPanelProps) {
	generalReviewCalls.length = 0;
	generalFrameCalls.length = 0;
	nativeFieldNodes.length = 0;
	return renderToStaticMarkup(React.createElement(generalProduction.GeneralPanelProbe, props));
}
function generalNativeInput(field: "title" | "description") {
	const input = nativeFieldNodes.find((node) => ["input", "textarea"].includes(node.tag) && node.props.id.endsWith("-" + field));
	assert.ok(input, field + " native input");
	return input;
}
const buttonLabel = (props: Record<string, any>) => React.Children.toArray(props.children).filter((child) => typeof child === "string").join("");
// The production footer, rendered with the actual native save controls and the dialog's Social and Close handlers.
let footerElement: ts.JsxElement | undefined;
function findFooter(node: ts.Node): void {
	if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((property) =>
		ts.isJsxAttribute(property) && property.name.getText(parsedSource) === "data-dialog-footer")) {
		assert.equal(footerElement, undefined, "there is one dialog footer");
		footerElement = node;
	}
	ts.forEachChild(node, findFooter);
}
findFooter(productionDeclaration("SearchPreview"));
assert.ok(footerElement);
// Focus order: the dialog popup ends with its footer, and Close is followed only by the save buttons, so the
// popup's own focus guards wrap Tab from the last control; nothing focusable sits between the popup and its guards.
{
	const dialogElement = footerElement.parent;
	assert.ok(ts.isJsxElement(dialogElement) && dialogElement.openingElement.tagName.getText(parsedSource) === "Dialog");
	const children = dialogElement.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) ||
		(ts.isJsxExpression(child) && child.expression));
	assert.equal(children.at(-1), footerElement, "the footer is the popup's last child");
	const primary = footerElement.children.filter(ts.isJsxElement).at(-1)!;
	assert.match(primary.openingElement.getText(parsedSource), /shipit-seo-snippet-dialog__footer-primary/);
	const primaryText = primary.getText(parsedSource);
	assert.ok(primaryText.indexOf("Close</Button>") < primaryText.indexOf("Save social text") &&
		primaryText.indexOf("Save social text") < primaryText.indexOf("<NativeSeoSaveButton"), "Close, then the scope-labelled saves");
	assert.equal(dialogElement.parent && ts.isJsxElement(dialogElement.parent) ? dialogElement.parent.openingElement.tagName.getText(parsedSource) : null, "Dialog.Root");
}
const searchPreviewStatement = (name: string) => {
	const statement = (productionDeclaration("SearchPreview") as ts.FunctionDeclaration).body!.statements.find((item) => ts.isVariableStatement(item) &&
		item.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name));
	assert.ok(statement, name);
	return statement.getText(parsedSource);
};
const footerButtons: Array<Record<string, any>> = [];
const footerCalls = { socialSaves: 0, socialChecks: 0, closes: [] as boolean[] };
type FooterProps = { dialogView: string; nativeEditor: NativeSeoEditorController; socialDirty?: boolean; socialPhase?: string; socialLocked?: boolean; nativeBusy?: boolean };
const footerProduction = compileProduction(
	"function FooterProbe({ dialogView, nativeEditor, socialDirty = false, socialPhase = \"idle\", socialLocked = false, nativeBusy = false, savedEntry = null }) {\n" +
	"const socialState = { phase: socialPhase }; const socialBusy = socialPhase === \"saving\" || socialPhase === \"checking\";\n" +
	"const saveNotice = null; const socialRetained = true; const socialPreview = { context: { metadataCurrent: true } };\n" +
	searchPreviewStatement("nativePhase") + "\n" + searchPreviewStatement("nativeChanged") + "\n" + searchPreviewStatement("nativeFooter") + "\n" +
	"return (" + footerElement.getText(parsedSource) + ");\n}\nmodule.exports = { FooterProbe };", {
	React,
	NativeSeoSaveStatus: nativeFieldsProduction.NativeSeoSaveStatus, NativeSeoRecoveryActions: nativeFieldsProduction.NativeSeoRecoveryActions,
	NativeSeoSaveButton: nativeFieldsProduction.NativeSeoSaveButton, nativeSeoHasChanges: nativeFieldsProduction.nativeSeoHasChanges,
	nativeSeoSaveOutstanding: nativeFieldsProduction.nativeSeoSaveOutstanding,
	Button: (props: Record<string, any>) => {
		footerButtons.push(props);
		return React.createElement("button", { type: "button", disabled: Boolean(props.disabled) }, props.children);
	},
	saveSocial: async () => { footerCalls.socialSaves += 1; },
	checkSavedSocial: async () => { footerCalls.socialChecks += 1; },
	handleEditorOpenChange: (open: boolean) => { footerCalls.closes.push(open); },
}) as { FooterProbe: React.ComponentType<FooterProps> };
function renderFooter(props: FooterProps) {
	footerButtons.length = 0;
	nativeFieldNodes.length = 0;
	const html = renderToStaticMarkup(React.createElement(footerProduction.FooterProbe, props));
	const buttons = [
		...footerButtons.map((props) => ({ label: buttonLabel(props), props })),
		...nativeFieldNodes.filter((node) => node.tag === "button").map((node) => ({ label: buttonLabel(node.props), props: node.props })),
	];
	const find = (label: string) => buttons.find((button) => button.label === label)?.props;
	return { html, buttons, find, primaries: buttons.filter((button) => button.props.variant === "primary").map((button) => button.label) };
}
for (const values of [
	{ title: null, description: null, image: null },
	{ title: "Native saved SEO title", description: "Native saved SEO description", image: null },
] satisfies nativeSeoState.NativeSeoValues[]) {
	const preview = { ...reviewPreview,
		search: { ...reviewPreview.search, title: values.title ?? reviewSavedTitle, description: values.description ?? reviewSavedDescription,
			fallbackTitle: reviewSavedTitle, fallbackDescription: reviewSavedDescription },
		sources: { ...reviewPreview.sources, title: values.title ? "core-seo" : "template", description: values.description ? "core-seo" : "template" },
	};
	for (const serpContext of [false, true]) {
		for (const field of [null, "title", "description", "slug"]) {
			for (const previewError of [false, true]) {
				const editor = generalNativeEditor(values);
				const before = JSON.stringify(editor.controller.state);
				const html = renderGeneral({ preview, reviewField: field, serpContext, previewError, nativeEditor: editor.controller });
				assert.equal(JSON.stringify(editor.controller.state), before, "opening General never changes its native draft or baseline");
				assert.deepEqual(editor.writes, [], "opening or changing the General view never saves");
				assert.equal(generalSocialWrites, 0, "General does not save plugin Social text");
				assert.equal(generalFrameCalls.length, 1);
				assert.equal(generalFrameCalls[0].preview, preview);
				assert.equal(generalFrameCalls[0].nativeEditor, editor.controller, "the form and preview use the same native draft owner");
				assert.equal(generalFrameCalls[0].descriptionDisplay, "external");
				assert.equal(Boolean(generalFrameCalls[0].resultPage), serpContext);
				assert.equal(generalFrameCalls[0].lastLoaded, previewError);
				assert.equal((html.match(/data-preview-kind="search"/g) ?? []).length, 1);
				const fullDescriptions = [...html.matchAll(/<p data-preview-description-text[^>]*>([\s\S]*?)<\/p>/g)];
				assert.equal(fullDescriptions.length, 1, "both General layouts retain one complete description readout");
				assert.equal(fullDescriptions[0][1], escapeMarkup(preview.search.description), "the readout preserves complete resolved text, including inheritance");
				assert.match(html, /<aside[^>]*class="sr-only"[^>]*data-preview-metadata[^>]*aria-label="Full preview metadata"/);
				assert.doesNotMatch(html, /About this preview|Recommended: 120-160 characters|Google may shorten or replace the snippet|Shortened in this card preview/);
				assert.ok(html.includes(escapeMarkup(preview.search.title)));
				assert.ok(html.includes(escapeMarkup(preview.search.url)));
				assert.doesNotMatch(html, /type="url"|contenteditable=|<form\b/i, "General does not edit the URL or nest the host form");
				assert.equal(html.includes('class="shipit-seo-serp-context"'), serpContext);
				if (field === "slug") {
					assert.deepEqual(generalReviewCalls, [{ preview, field, previewError }]);
					assert.equal(nativeFieldNodes.filter((node) => ["input", "textarea"].includes(node.tag)).length, 0, "the slug handoff remains a read-only owner review");
					assert.ok(html.indexOf('aria-label="Search result preview"') < html.indexOf("data-general-review-probe"));
				} else {
					assert.equal(generalReviewCalls.length, 0, "General text fields replace the earlier read-only title/description note");
					for (const name of ["title", "description"] as const) {
						const input = generalNativeInput(name);
						assert.equal(input.props.value, values[name] ?? "", "resolved fallback text never becomes the editable native value");
						assert.equal(input.props.disabled, false);
						assert.equal(input.props.placeholder, name === "title" ? reviewSavedTitle : reviewSavedDescription);
					}
					assert.equal(nativeFieldNodes.some((node) => node.tag === "button"), false, "the General field column holds no save button");
				}
				if (previewError) assert.match(html, /Last.loaded/i);
			}
		}
	}
}
const changedGeneral = generalNativeEditor({ title: null, description: "Existing native description", image: null });
const changedGeneralPreview = { ...reviewPreview,
	search: { ...reviewPreview.search, description: "Existing native description", fallbackTitle: reviewSavedTitle, fallbackDescription: reviewSavedDescription },
	sources: { ...reviewPreview.sources, title: "template", description: "core-seo" },
};
const changedGeneralProps: GeneralPanelProps = { preview: changedGeneralPreview, reviewField: "title", serpContext: false, previewError: false, nativeEditor: changedGeneral.controller };
renderGeneral(changedGeneralProps);
let preventedNativeTitleSubmit = false;
generalNativeInput("title").props.onKeyDown({ key: "Enter", preventDefault: () => { preventedNativeTitleSubmit = true; } });
assert.equal(preventedNativeTitleSubmit, true, "Enter in the native title cannot submit the parent content form");
assert.deepEqual(changedGeneral.writes, [], "Enter does not save native SEO implicitly");
generalNativeInput("title").props.onChange({ target: { value: "Explicit native title draft" } });
assert.deepEqual(changedGeneral.writes, [], "typing changes only the local native draft");
const changedGeneralHtml = renderGeneral(changedGeneralProps);
assert.equal(generalNativeInput("title").props.value, "Explicit native title draft");
assert.match(changedGeneralHtml, /Unsaved changes/);
assert.equal(nativeFieldNodes.some((node) => node.tag === "button"), false);
for (const dialogView of ["general", "social", "schema"]) {
	const footer = renderFooter({ dialogView, nativeEditor: changedGeneral.controller });
	assert.equal(footer.find("Save SEO fields")?.disabled, false, dialogView + ": the native save is reachable from every tab");
	assert.match(footer.html, /Changed: SEO title</, dialogView + ": the footer names what the save sends");
	assert.deepEqual(footer.primaries, ["Save SEO fields"], dialogView + ": one primary action");
	assert.equal(footer.find("Close")?.variant, "secondary", "Close is always secondary");
	assert.equal(footer.find("Save social text"), undefined, "a clean Social draft offers no Social save");
	assert.ok(footer.find("Check saved SEO fields"), dialogView + ": changed native fields keep their recovery reachable");
}
renderFooter({ dialogView: "social", nativeEditor: changedGeneral.controller }).find("Save SEO fields")!.onClick();
assert.deepEqual(changedGeneral.writes, [{ seo: { title: "Explicit native title draft" }, _rev: "general-revision" }],
	"explicit Save SEO fields contains only the changed native field and its guard");
assert.equal(footerCalls.socialSaves, 0, "the native save does not submit Social text");
const cleanFooterEditor = generalNativeEditor({ title: "Saved title", description: null, image: null });
for (const dialogView of ["general", "social", "schema"]) {
	const footer = renderFooter({ dialogView, nativeEditor: cleanFooterEditor.controller });
	assert.deepEqual(footer.primaries, [], dialogView + ": nothing to save offers no primary");
	assert.equal(footer.find("Save SEO fields"), undefined);
	assert.equal(footer.find("Close")?.variant, "secondary");
	assert.equal(Boolean(footer.find("Check saved SEO fields")), dialogView !== "schema", dialogView + ": native recovery shows on the tabs that edit native fields");
}
let footer = renderFooter({ dialogView: "general", nativeEditor: cleanFooterEditor.controller, socialDirty: true });
assert.deepEqual(footer.primaries, ["Save social text"], "a dirty Social draft alone makes its save primary");
footer.find("Save social text")!.onClick();
assert.equal(footerCalls.socialSaves, 1, "the Social save is reachable from another tab");
assert.deepEqual(cleanFooterEditor.writes, [], "the Social save sends no native write");
cleanFooterEditor.controller.change({ description: "Changed native description" });
footer = renderFooter({ dialogView: "social", nativeEditor: cleanFooterEditor.controller, socialDirty: true });
assert.deepEqual(footer.primaries, ["Save SEO fields"], "with both drafts dirty only the native save is primary");
assert.equal(footer.find("Save social text")?.variant, "secondary");
assert.deepEqual(footer.buttons.filter((button) => button.label.startsWith("Save ")).map((button) => button.label).sort(), ["Save SEO fields", "Save social text"]);
assert.ok(footer.html.indexOf(">Close<") < footer.html.indexOf(">Save social text<") && footer.html.indexOf(">Save social text<") < footer.html.indexOf("Save SEO fields"),
	"Close comes first and the primary save last");
footer = renderFooter({ dialogView: "social", nativeEditor: cleanFooterEditor.controller, socialDirty: true, socialLocked: true });
assert.equal(footer.find("Save social text")?.disabled, true, "a locked Social draft cannot be saved");
footer = renderFooter({ dialogView: "general", nativeEditor: cleanFooterEditor.controller, socialPhase: "saving" });
assert.equal(footer.find("Save social text")?.loading, true);
assert.equal(footer.find("Save social text")?.disabled, true);
assert.equal(footer.find("Close")?.disabled, true, "a pending Social save cannot be closed away");
footer = renderFooter({ dialogView: "general", nativeEditor: cleanFooterEditor.controller, socialDirty: true, nativeBusy: true });
assert.equal(footer.find("Close")?.disabled, true);
assert.equal(footer.find("Save social text")?.disabled, true, "a pending native operation also holds the Social save");
footer.find("Close")!.onClick();
assert.deepEqual(footerCalls.closes, [false], "Close only asks the dialog to close");
assert.equal(generalSocialWrites, 0, "native saving does not submit the separate plugin Social text form");
assert.match(noteMarkup("title", reviewPreview.sources, true), /last.loaded/i);
assert.doesNotMatch(noteMarkup(null), /data-review-field|Review saved title|Review saved URL/);

// Social tab: the share preview leads, then the Sharing image card, then Customize for social. It holds no save button.
const socialProduction = compileProduction(productionDeclaration("SocialPreview").getText(parsedSource) + "\nmodule.exports = { SocialPreview };", {
	React, ...previewIcons, SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH: 200, SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH: 500,
	nativeSeoCharacterCount: (nativeFieldsProduction as unknown as { nativeSeoCharacterCount: (value: string, limit: number) => string }).nativeSeoCharacterCount,
	NativeSeoImageField: (nativeFieldsProduction as unknown as { NativeSeoImageField: React.ComponentType<Record<string, unknown>> }).NativeSeoImageField,
	useSeoBrand, legacyRecordGuidance: metadataModule.legacyRecordGuidance,
	ResolvedSocialPreview: () => React.createElement("figure", { "data-probe-share-preview": true }, "Share card"),
	Switch: (props: Record<string, unknown>) => React.createElement("button", { type: "button", role: "switch", "aria-checked": Boolean(props.checked) }, String(props["aria-label"])),
	Button: (props: Record<string, any>) => React.createElement("button", { type: "button", disabled: Boolean(props.disabled) }, props.children),
}) as { SocialPreview: React.ComponentType<Record<string, unknown>> };
const socialImageEditor = generalNativeEditor({ title: null, description: null, image: null });
assert.match(productionDeclaration("SocialPreview").getText(parsedSource), /-title-limit`\}>\{nativeSeoCharacterCount\(title, SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH\)\}/,
	"Social counters use the native counter format");
assert.doesNotMatch(source, /input limit<\/span>/, "no slash-style counter remains");
const socialPanelElement = (customizing: boolean) => React.createElement(socialProduction.SocialPreview, {
	preview: { ...reviewPreview, social: { fallbackTitle: "Inherited sharing title", fallbackDescription: "Inherited sharing description", image: null } },
	view: { model: {}, fieldBasis: {}, caption: undefined, context: { metadataNeedsRefresh: false, clearMayRevealAlias: false } },
	platform: "facebook", onPlatformChange: () => undefined,
	draft: { customizing }, onDraftChange: () => undefined, savedTitle: "", savedDescription: "", editable: true, phase: "idle", dirty: false,
	nativeEditor: socialImageEditor.controller, imagePickerOpen: false, onImagePickerOpenChange: () => undefined,
	imagePickerError: null, onImagePickerError: () => undefined,
});
for (const customizing of [false, true]) {
	nativeFieldNodes.length = 0;
	const socialHtml = renderToStaticMarkup(socialPanelElement(customizing));
	const order = ['class="shipit-seo-native-social__preview"', "data-probe-share-preview", 'class="shipit-seo-native-social__settings"', "<strong>Sharing image</strong>",
		"Use a landscape image, for example 1200 x 630 px.", ">Choose image<", "<strong>Customize for social</strong>"].map((landmark) => socialHtml.indexOf(landmark));
	assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])),
		"Social leads with the preview, then the image card and its guidance, then Customize for social: " + JSON.stringify(order));
	const socialTitle = socialHtml.indexOf(">Social title</label>");
	assert.equal(socialTitle > socialHtml.indexOf("<strong>Customize for social</strong>"), customizing, "custom sharing text follows its switch");
	assert.doesNotMatch(socialHtml, /Save SEO|Save social|Check saved/, "the Social columns hold no save or recovery buttons");
}
assert.match(productionDeclaration("SocialPreview").getText(parsedSource), /aria-label="X preview"\s*aria-pressed=\{platform === "x"\}\s*onClick=\{\(\) => onPlatformChange\("x"\)\}/,
	"the Facebook and X switch still drives the preview platform");

const previewFunction = productionDeclaration("SearchPreview") as ts.FunctionDeclaration;
const openChange = previewFunction.body!.statements.find((statement) => ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "handleEditorOpenChange"))!;
const previewEffects = previewFunction.body!.statements.filter((statement) => ts.isExpressionStatement(statement) &&
	ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsedSource) === "React.useEffect");
const requestEffect = previewEffects.find((statement) => statement.getText(parsedSource).includes("dialogRequest.ref")) as ts.ExpressionStatement;
const targetEffect = previewEffects.find((statement) => statement.getText(parsedSource).includes("setReviewField(null)")) as ts.ExpressionStatement;
assert.ok(requestEffect);
assert.ok(targetEffect);
const effectCallback = (statement: ts.ExpressionStatement) => (statement.expression as ts.CallExpression).arguments[0].getText(parsedSource);
let currentField: string | null = "title";
let currentView = "general";
let dialogOpen = true;
const closeStore = createSocialEditorStore({ ref: "posts:action-owner", locale: "en" });
closeStore.observeEditing({ state: "ready", snapshot: { ref: "posts:action-owner", revision: null, override: null } });
const initialDraft = { customizing: true, title: "Local Social draft" };
closeStore.setDraft(initialDraft);
closeStore.updateState({ type: "draft", draftIdentity: initialDraft });
let localDraft: SocialOverrideDraftState | null = initialDraft;
const socialStateRef = closeStore.stateRef;
const startedSave = beginSocialSave(socialStateRef.current, { draftIdentity: initialDraft, values: { title: "Local Social draft", description: "" } });
assert.ok(startedSave.attempt);
closeStore.installState(startedSave.state);
function boundCallbacks(request: unknown, ref = "posts:action-owner", locale: string | null = "en", nativeBusy = false) {
	return compileProduction(openChange.getText(parsedSource) +
		"\nconst applyRequest = " + effectCallback(requestEffect) + ";" +
		"\nconst resetTarget = " + effectCallback(targetEffect) + ";" +
		"\nmodule.exports = { handleEditorOpenChange, applyRequest, resetTarget };", {
			dialogRequest: request, preview: { content: { ref } }, locale, nativeBusy,
			setReviewField: (value: string | null) => { currentField = value; },
			setDialogView: (value: string) => { currentView = value; },
			setEditing: (value: boolean) => { dialogOpen = value; },
			canCloseSocialSave, closeSocialSave, socialStateRef,
			installSocialState: closeStore.installState,
			setSocialDraft: (value: SocialOverrideDraftState | null) => { closeStore.setDraft(value); localDraft = value; },
		}) as { handleEditorOpenChange: (open: boolean) => void; applyRequest: () => void; resetTarget: () => void };
}
const titleRequest = { view: "general", reviewField: "title", ref: "posts:action-owner", locale: "en", nonce: 1 };
for (const request of [null, { ...titleRequest, ref: null }, { view: "general", reviewField: "title" }]) {
	currentField = null;
	dialogOpen = false;
	boundCallbacks(request).applyRequest();
	assert.deepEqual([currentField, dialogOpen], [null, false], "missing or malformed target cannot open a review");
}
currentField = "title";
dialogOpen = true;
let callbacks = boundCallbacks(titleRequest);
callbacks.handleEditorOpenChange(false);
assert.deepEqual([currentField, dialogOpen, localDraft], ["title", true, initialDraft],
	"a refused pending-Social close keeps the review and draft");
closeStore.settle({ type: "save-unconfirmed", attempt: startedSave.attempt });
boundCallbacks(titleRequest, "posts:action-owner", "en", true).handleEditorOpenChange(false);
assert.deepEqual([currentField, dialogOpen, localDraft], ["title", true, initialDraft],
	"a pending native SEO operation also refuses Close without touching the Social draft");
callbacks.handleEditorOpenChange(false);
assert.deepEqual([currentField, dialogOpen, localDraft], [null, false, initialDraft]);
assert.equal(socialStateRef.current.phase, "unconfirmed", "accepted close preserves the uncertain attempt");
callbacks.applyRequest();
assert.deepEqual([currentField, currentView, dialogOpen], ["title", "general", true]);
callbacks.handleEditorOpenChange(true);
assert.equal(currentField, null, "ordinary Edit snippet opening has no old checklist instruction");
const socialRequestCallbacks = boundCallbacks({ view: "social", ref: "posts:action-owner", locale: "en", nonce: 2 });
socialRequestCallbacks.applyRequest();
assert.equal(currentView, "social", "the Social opener opens the dialog on Social");
socialRequestCallbacks.handleEditorOpenChange(true);
assert.equal(currentView, "general", "Edit snippet always opens on General");
callbacks.applyRequest();
callbacks.resetTarget();
assert.equal(currentField, null, "changing entry or locale clears the instruction");
dialogOpen = false;
for (const [ref, locale] of [["posts:other", "en"], ["posts:action-owner", "nl"]] as const) {
	callbacks = boundCallbacks(titleRequest, ref, locale);
	callbacks.applyRequest();
	assert.deepEqual([currentField, dialogOpen], [null, false], "a request for another entry or locale cannot open a review");
}

// The actual Close callback discards A after the owner deliberately adopts B.
// Its retained store must not repeat the adoption notice when the popup reopens.
callbacks = boundCallbacks(null);
const closeRecovery = beginSocialRecovery(socialStateRef.current);
assert.ok(closeRecovery.request);
closeStore.installState(closeRecovery.state);
const otherSavedSnapshot: SeoAdminSocialOverrideSnapshot = {
	ref: "posts:action-owner", revision: "revision-other-editor", override: {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
		ref: "posts:action-owner", title: "Saved by another editor", description: "Other saved description",
		updatedAt: "2026-10-16T12:00:00.000Z",
	},
};
const otherSavedRead: SeoAdminSocialOverrideReadResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION,
	success: true as const, ref: "posts:action-owner", snapshot: otherSavedSnapshot,
};
closeStore.settle({ type: "recovery-result", request: closeRecovery.request, result: otherSavedRead });
assert.equal(socialStateRef.current.phase, "review");
const reviewBeforeClose = socialStateRef.current;
callbacks.handleEditorOpenChange(false);
assert.equal(socialStateRef.current, reviewBeforeClose, "review Close keeps the exact unresolved state");
assert.equal(localDraft, initialDraft);
closeStore.installState(reviewSocialSaveValues(socialStateRef.current));
assert.equal(socialStateRef.current.notice?.kind, "rebased");
assert.equal(localDraft, initialDraft);
assert.equal(closeStore.draftRef.current, initialDraft);
const adoptedBaseline = socialStateRef.current.baseline;
const adoptedSequence = socialStateRef.current.sequence;
const adoptedEpoch = closeStore.previewEpochRef.current;
const adoptedOwner = closeStore.previewOwnerRef.current;
assert.equal(adoptedBaseline?.revision, "revision-other-editor");
callbacks.handleEditorOpenChange(true);
callbacks.handleEditorOpenChange(false);
assert.equal(dialogOpen, false);
assert.equal(localDraft, null);
assert.equal(closeStore.getSnapshot().draft, null);
assert.equal(socialStateRef.current.draftIdentity, null);
assert.equal(socialStateRef.current.acknowledgedDraftIdentity, null);
assert.equal(socialStateRef.current.notice, null, "ordinary Close dismisses the adoption event notice");
assert.equal(socialStateRef.current.baseline, adoptedBaseline);
assert.equal(socialStateRef.current.sequence, adoptedSequence);
assert.equal(closeStore.previewEpochRef.current, adoptedEpoch);
assert.equal(closeStore.previewOwnerRef.current, adoptedOwner);
callbacks.handleEditorOpenChange(true);
assert.equal(dialogOpen, true);
assert.equal(closeStore.getSnapshot().draft, null);
assert.equal(socialStateRef.current.baseline?.override?.title, "Saved by another editor");
assert.equal(socialSaveNoticeMessage(socialStateRef.current.notice, false), null,
	"the reopened footer cannot claim that discarded local edits are kept");
const reopenedState = socialStateRef.current;
closeStore.settle({ type: "save-unconfirmed", attempt: startedSave.attempt });
closeStore.settle({ type: "recovery-result", request: closeRecovery.request, result: otherSavedRead });
assert.equal(socialStateRef.current, reopenedState, "late responses cannot restore a dismissed notice");
assert.equal(canSaveSocialValues(socialStateRef.current), true);
const nextAfterDiscard = beginSocialSave(socialStateRef.current, {
	draftIdentity: {}, values: { title: "Next deliberate edit", description: "" },
});
assert.equal(nextAfterDiscard.attempt?.expectedRevision, "revision-other-editor");

closeStore.dispose();
assert.match(source, /onOpenChange=\{handleEditorOpenChange\}/);
assert.match(source, /setReviewField\(null\);\s*setDialogView\(value as SnippetDialogView\)/);
assert.match(source, /SNIPPET_DIALOG_VIEWS\.includes\(value as SnippetDialogView\) && value !== dialogView/,
	"autofocusing the already selected tab keeps the checklist instruction");
const workflowFunction = productionDeclaration("SeoEditorWorkflow") as ts.FunctionDeclaration;
const requestDeclaration = workflowFunction.body!.statements.find((statement) => ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "requestDialog"))!;
let requested: unknown = null;
function requestReview(preview: unknown) {
	return compileProduction(requestDeclaration.getText(parsedSource) + "\nmodule.exports = { requestDialog };", {
		preview, locale: "en", setDialogRequest: (update: (current: null) => unknown) => { requested = update(null); },
	}).requestDialog as (view: string, field: string) => void;
}
requestReview(null)("general", "title");
assert.equal(requested, null, "missing preview never queues a dialog for a later load");
requestReview({ content: { ref: "posts:action-owner" } })("general", "description");
assert.deepEqual(requested, { view: "general", reviewField: "description", ref: "posts:action-owner", locale: "en", nonce: 1 });

// Row actions move focus to their field and back: the production handlers with a recorded DOM.
const workflowStatement = (name: string) => {
	const statement = workflowFunction.body!.statements.find((item) => ts.isVariableStatement(item) &&
		item.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name));
	assert.ok(statement, name);
	return statement.getText(parsedSource);
};
const focusLog: string[] = [];
const fixCalls: unknown[][] = [];
const fixOriginRef: { current: unknown } = { current: null };
const fixWorkflowRef = { current: { querySelector: (selector: string) => {
	if (selector === '[data-group-summary="additional"]') return { focus: () => focusLog.push("group summary") };
	if (selector === '[data-strip-entry="advanced"]') return { focus: () => focusLog.push("advanced button") };
	return null;
} } };
const fixProduction = compileProduction([workflowStatement("restoreFixFocus"), workflowStatement("handleCheckFix"), workflowStatement("openDialogFrom")].join("\n") +
	"\nmodule.exports = { handleCheckFix, restoreFixFocus, openDialogFrom };", {
	resolveCheckFixTarget, fixOrigin: fixOriginRef, workflowRef: fixWorkflowRef, tabId: "panel",
	requestDialog: (...args: unknown[]) => { fixCalls.push(["dialog", ...args]); },
	setActiveView: (view: string) => { fixCalls.push(["view", view]); },
	afterPaint: (run: () => void) => { run(); return () => undefined; },
	window: { requestAnimationFrame: (run: () => void) => { run(); return 0; } },
	document: { getElementById: (id: string) => ({ focus: () => focusLog.push("#" + id) }) },
}) as { handleCheckFix: (check: SeoContentCheck, origin?: unknown) => void; restoreFixFocus: () => void; openDialogFrom: (view: string, opener: unknown) => void };
fixProduction.handleCheckFix(actionRow("focus-keyword", noKeywordInput).check, null);
assert.deepEqual([fixCalls, focusLog], [[["view", "analysis"]], ["#panel-focus-keyword"]], "Add keyword focuses the keyword field");
assert.match(source, /id=\{`\$\{idPrefix\}-focus-keyword`\}/, "the focused id is the keyword input");
fixCalls.length = 0; focusLog.length = 0;
const fixButton = (connected: boolean) => ({
	isConnected: connected, focus: () => focusLog.push("action button"),
	closest: (selector: string) => selector === "[data-group-id]" ? { getAttribute: (name: string) => name === "data-group-id" ? "additional" : null } : null,
});
for (const connected of [true, false]) {
	const origin = fixButton(connected);
	fixProduction.handleCheckFix(actionRow("social-image").check, origin);
	assert.deepEqual(fixCalls.at(-1), ["dialog", "social", undefined]);
	assert.deepEqual(fixOriginRef.current, { element: origin, groupId: "additional" });
	fixProduction.restoreFixFocus();
	assert.equal(focusLog.at(-1), connected ? "action button" : "group summary", "closing returns focus to the action, or to its group when the row is gone");
	assert.equal(fixOriginRef.current, null);
}
focusLog.length = 0;
fixProduction.restoreFixFocus();
assert.deepEqual(focusLog, [], "a dialog opened elsewhere keeps the dialog's own focus return");
fixProduction.handleCheckFix(actionRow("url", { ...actionInput, url: "ftp://example.invalid/bread" }).check, fixButton(true));
assert.deepEqual([fixCalls.at(-1), focusLog.at(-1)], [["view", "advanced"], "advanced button"], "Open Advanced keeps focus on the selected Advanced tab");
// Arrow keys rove focus between the two tabs; Enter and Space stay with the native button click that selects.
const tabKeys = compileProduction(workflowStatement("handleTabKeyDown") + "\nmodule.exports = { handleTabKeyDown };", {}) as
	{ handleTabKeyDown: (event: Record<string, unknown>) => void };
const tabFocus: string[] = [];
const tabSelectors: string[] = [];
const tabButtons = ["analysis", "advanced"].map((name) => ({ name, focus: () => tabFocus.push(name) }));
const tabStrip = { querySelectorAll: (selector: string) => { tabSelectors.push(selector); return tabButtons; } };
for (const [from, key, expected, prevented] of [
	["analysis", "ArrowRight", "advanced", true], ["advanced", "ArrowRight", "analysis", true],
	["analysis", "ArrowLeft", "advanced", true], ["advanced", "ArrowLeft", "analysis", true],
	["advanced", "Home", "analysis", true], ["analysis", "End", "advanced", true],
	["analysis", "Enter", null, false], ["analysis", " ", null, false], ["analysis", "ArrowDown", null, false],
] as const) {
	tabFocus.length = 0;
	let defaultPrevented = false;
	tabKeys.handleTabKeyDown({ key, preventDefault: () => { defaultPrevented = true; },
		currentTarget: Object.assign(tabButtons.find((button) => button.name === from)!, { parentElement: tabStrip }) });
	assert.deepEqual([tabFocus, defaultPrevented], [expected ? [expected] : [], prevented], `${key} from ${from}`);
}
assert.deepEqual([...new Set(tabSelectors)], ['button[role="tab"][data-strip-entry]'], "roving covers only the section tabs");
for (const view of ["social", "schema"]) {
	for (const connected of [true, false]) {
		const openerFocus: string[] = [];
		const opener = { isConnected: connected, focus: () => openerFocus.push(view + " opener") };
		fixProduction.openDialogFrom(view, opener);
		assert.deepEqual(fixCalls.at(-1), ["dialog", view], view + " opens the dialog on its tab");
		assert.deepEqual(fixOriginRef.current, { element: opener, groupId: null });
		fixProduction.restoreFixFocus();
		assert.deepEqual(openerFocus, connected ? [view + " opener"] : [], "closing returns focus to the opener that is still present");
	}
}
assert.match(source, /onDialogClose=\{restoreFixFocus\}/);
// The dialog reports its close and focuses a requested title or description once that field is editable.
const closeEffect = previewEffects.find((statement) => statement.getText(parsedSource).includes("onDialogClose?.()")) as ts.ExpressionStatement;
const fieldEffect = previewEffects.find((statement) => statement.getText(parsedSource).includes("data-native-seo-fields")) as ts.ExpressionStatement;
assert.ok(closeEffect && fieldEffect);
let dialogCloses = 0;
const wasEditingRef = { current: false };
for (const [editing, closes] of [[true, 0], [true, 0], [false, 1], [false, 1]] as const) {
	(compileProduction("module.exports = { run: " + effectCallback(closeEffect) + " };", {
		editing, wasEditing: wasEditingRef, onDialogClose: () => { dialogCloses += 1; },
	}) as { run: () => void }).run();
	assert.equal(dialogCloses, closes, "only an open-to-closed change reports a close");
}
for (const [reviewField, active, expected] of [
	["title", "tab", '.shipit-seo-snippet-dialog [data-native-seo-fields] [id$="-title"]:not(:disabled)'],
	["description", "body", '.shipit-seo-snippet-dialog [data-native-seo-fields] [id$="-description"]:not(:disabled)'],
	["description", "field", null],
	["slug", "tab", null],
] as const) {
	const queries: string[] = [];
	const body = { closest: () => null };
	const activeElement = active === "body" ? body : { closest: (selector: string) => active === "tab" && selector === "[data-dialog-view]" ? {} : null };
	(compileProduction("module.exports = { run: " + effectCallback(fieldEffect) + " };", {
		editing: true, dialogView: "general", reviewField,
		afterPaint: (run: () => void) => { run(); return () => undefined; },
		document: { body, activeElement, querySelector: (selector: string) => { queries.push(selector); return { focus: () => queries.push("focused") }; } },
	}) as { run: () => void }).run();
	assert.deepEqual(queries, expected ? [expected, "focused"] : [], `${reviewField} from ${active}`);
}

// The same production workflow surrounds current checks and unavailable analysis.
// Leaf form controllers retain their own save/recovery checks above.
const savedPanelDeclaration = productionDeclaration("SavedSeoEditorPanel") as ts.FunctionDeclaration;
const unavailableDeclaration = savedPanelDeclaration.body!.statements.find((statement) =>
	ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) =>
		ts.isIdentifier(item.name) && item.name.text === "unavailableAnalysis"));
assert.ok(unavailableDeclaration && ts.isVariableStatement(unavailableDeclaration));
const unavailableContent = unavailableDeclaration.declarationList.declarations[0].initializer;
assert.ok(unavailableContent);
assert.equal((savedPanelSource.match(/<SeoAnalysisDisclosure\b/g) ?? []).length, 1,
	"background analysis readback changes slots without replacing the dialog owner");
assert.match(savedPanelSource, /<SeoAnalysisDisclosure\s*key="editor-workflow"/);
assert.doesNotMatch(savedPanelSource, /<SeoEditorWorkflow|if \(!scoringEnabled \|\| !score/);
assert.equal((source.match(/aria-label="SEO sections"/g) ?? []).length, 1, "all analysis states use one production tab list");
assert.doesNotMatch(source, /shipit-seo-native-panel--scoring-off|<summary>Advanced SEO settings<\/summary>/);
assert.match(editorCss, /shipit-seo-native-panel-state--availability[\s\S]*?display: grid/);
const workflowDeclaration = productionDeclaration("SeoEditorWorkflow");
assert.doesNotMatch(workflowDeclaration.getText(parsedSource), /useQuery|useMutation|\bfetch[A-Z]|\bsave[A-Z]|\bonRefresh\b/,
	"the shared shell owns presentation and user handoffs, never analysis admission or work");

// The production Analysis owner is unconditional; hiding it must not replace
// the profile form, its dirty selection or any other local control subtree.
const retainedAnalysisPanels: ts.JsxElement[] = [];
function findRetainedAnalysisPanel(node: ts.Node): void {
	if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
		attribute.name.getText(parsedSource) === "data-editor-view" && attribute.initializer?.getText(parsedSource) === '"analysis"')) retainedAnalysisPanels.push(node);
	ts.forEachChild(node, findRetainedAnalysisPanel);
}
findRetainedAnalysisPanel(workflowDeclaration);
assert.equal(retainedAnalysisPanels.length, 1);
assert.match(retainedAnalysisPanels[0].getText(parsedSource), /hidden=\{activeView !== "analysis"\}/);
for (let ancestor: ts.Node | undefined = retainedAnalysisPanels[0].parent; ancestor && ancestor !== workflowDeclaration; ancestor = ancestor.parent) {
	assert.ok(!ts.isConditionalExpression(ancestor) && !ts.isIfStatement(ancestor), "section selection cannot unmount the Analysis owner");
}
assert.match(css, /\.shipit-seo-native-panel__view\[hidden\]\s*\{\s*display:\s*none;/,
	"the native hidden attribute wins over the panel's grid display rule");
assert.match(source, /data-editor-view="advanced"\s*hidden=\{activeView !== "advanced"\}\s*>\s*\{activeView === "advanced" \? <>\s*\{advancedNotice\}\s*\{preview \?/,
	"ownership guidance remains in Advanced even without a resolved preview");
for (const view of ["analysis", "advanced"]) {
	assert.match(source, new RegExp(`role="tabpanel"\\s*id=\\{\`\\$\\{tabId\\}-${view}-panel\`\\}\\s*aria-labelledby=\\{\`\\$\\{tabId\\}-${view}-tab\`\\}`),
		view + " is a tab panel named by its tab");
}

let workflowView: "analysis" | "advanced" = "analysis";
const workflowPreviews: Array<Record<string, unknown>> = [];
const workflowButtons: Array<Record<string, unknown>> = [];
const workflowSections: Array<Record<string, unknown>> = [];
const workflowCalls = { analyze: 0, social: 0, preview: 0, score: 0, directives: 0, settings: 0 };
const workflowCallbacks = {
	analyze: () => { workflowCalls.analyze += 1; },
	social: async () => { workflowCalls.social += 1; },
	preview: () => { workflowCalls.preview += 1; },
	score: () => { workflowCalls.score += 1; },
	directives: () => { workflowCalls.directives += 1; },
	settings: () => { workflowCalls.settings += 1; },
};
const workflowJsx = requireMetadataRuntime("react/jsx-runtime") as {
	jsx: (type: unknown, props: Record<string, unknown>, key?: unknown) => React.ReactElement;
	jsxs: (type: unknown, props: Record<string, unknown>, key?: unknown) => React.ReactElement;
};
const captureWorkflowElement = (factory: typeof workflowJsx.jsx) => (type: unknown, props: Record<string, unknown>, key?: unknown) => {
	if (type === "button") workflowButtons.push(props);
	if (type === "div" && (props["data-editor-view"] === "analysis" || props["data-editor-view"] === "advanced")) workflowSections.push(props);
	return factory(type, props, key);
};
const workflowReact = {
	...React,
	useState: (initial: unknown) => {
		const [value, setValue] = React.useState(initial === "analysis" ? workflowView : initial);
		return [value, initial === "analysis" ? (next: typeof workflowView) => { workflowView = next; setValue(next); } : setValue];
	},
};
const workflowProduction = compileProduction([
	workflowDeclaration.getText(parsedSource), disclosureDeclaration.getText(parsedSource),
	... ["afterPaint", "editorAnalysisSource", "sourceResult", "sourceDisplay", "ANALYSIS_SCOPE_TEXT", "AnalysisScopeNote",
		"AnalysisScoreHeader", "BAND_TONES", "AnalysisHeader", "normaliseKeywordDraft", "FocusKeywordEditor"].map((name) => productionDeclaration(name).getText(parsedSource)),
	productionDeclaration("PreviewState").getText(parsedSource),
	`function UnavailableAnalysisProbe({ scoringEnabled, scoringUnknown = false, assessmentConfigured,
		profileUnavailable = false,
		storedUnavailable = false, history = false, analysisAdmitted = false }) {
	const score = null;
	const workspaceUrl = "/admin/plugins/shipit-seo/?view=content";
	const settingsQuery = { isError: false, refetch: workflowCallbacks.settings };
	const panelState = editorScoreStateCopy({ scoringEnabled, scoringUnknown, storedUnavailable,
		profileRequired: !assessmentConfigured, profileUnavailable });
	const savedActionElement = <button type="button" onClick={workflowCallbacks.analyze}>Analyze saved content</button>;
	const savedNoticeElement = null; const sessionState = { error: null };
	const storedScoreQuery = { isError: storedUnavailable, refetch: workflowCallbacks.score };
	const storedHistory = (note) => history ? <p data-stored-history>Last saved SEO score: 42/100. {note}</p> : null;
	return (${unavailableContent.getText(parsedSource)});
	}`,
	"module.exports = { SeoAnalysisDisclosure, UnavailableAnalysisProbe };",
].join("\n"), {
	React: workflowReact, workflowCallbacks, editorScoreStateCopy, SEO_WORKSPACE_URL: "/admin/plugins/shipit-seo/",
	resolveCheckFixTarget, hasCurrentEditorAnalysis, analysisPresentation, contentCheckPresentation, searchExclusionCheck, SEO_SCORE_VERSION,
	seoScoreDisplay, seoScoreLimitText, summarizeSeoChecks, seoCheckTotalsText, SEO_EARLIER_ANALYZER_LABEL,
	normaliseKeywordChip, seoKeywordIdentity, keywordCheckCoverage,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT, SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
	AnalysisChecklist: renderedProduction.AnalysisChecklist,
	SearchPreview: (props: Record<string, unknown>) => {
		workflowPreviews.push(props);
		return React.createElement(frameProduction.SearchSnippetFrame, {
			preview: props.preview, device: props.device, locale: props.locale, lastLoaded: props.previewError,
		});
	},

	AdvancedPanel: () => React.createElement("div", { "data-advanced-settings": true }, "Advanced controls"),
	Button: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) => {
		workflowButtons.push({ type: "button", disabled, onClick, children });
		return React.createElement("button", { type: "button", disabled, onClick }, children);
	},
	...previewIcons,
}, (name) => name === "react/jsx-runtime"
	? { ...workflowJsx, jsx: captureWorkflowElement(workflowJsx.jsx), jsxs: captureWorkflowElement(workflowJsx.jsxs) }
	: requireMetadataRuntime(name),
) as {
	SeoAnalysisDisclosure: React.ComponentType<Record<string, unknown>>;
	UnavailableAnalysisProbe: React.ComponentType<Record<string, unknown>>;
};
const workflowProps = {
	preview: reviewPreview, keywordCoverageConfirmed: true, locale: "en", siteSettings: null, previewLoading: false, previewError: false,
	workspaceUrl: "/admin/plugins/shipit-seo/?view=content", refreshing: false, sessionDisabled: false,
	refreshError: false, keywordsValue: ["dental implants"], keywordsInherited: false, keywordInputValue: "",
	keywordSaveState: { status: "clean" }, onKeywordRetry: () => undefined, pillar: false, onPillarChange: () => undefined,
	directives: null, directivesLoading: false, directivesLoadError: false, directivesSaving: false, directivesError: false,
	onDirectivesSave: workflowCallbacks.directives, onDirectivesRetry: workflowCallbacks.directives,
	onPreviewRetry: workflowCallbacks.preview, onRefresh: workflowCallbacks.analyze,
	onKeywordInputChange: () => undefined, onKeywordAdd: () => undefined, onKeywordRemove: () => undefined,
	onKeywordPromote: () => undefined, onSocialSave: workflowCallbacks.social, socialEditor: {},
};
const renderWorkflow = (component: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown>, view: typeof workflowView = "analysis") => {
	workflowView = view;
	workflowPreviews.length = 0;
	workflowButtons.length = 0;
	workflowSections.length = 0;
	return renderToStaticMarkup(React.createElement(component, props));
};
const assertWorkflow = (html: string, previewReady: boolean, view: typeof workflowView) => {
	assert.equal((html.match(/role="tablist"/g) ?? []).length, 1);
	assert.equal((html.match(/role="toolbar"/g) ?? []).length, 0);
	const tabs = workflowButtons.filter((button) => button["data-strip-entry"]);
	assert.deepEqual(tabs.map((button) => button["data-strip-entry"]), ["analysis", "advanced"], "the strip holds exactly two tabs");
	for (const tab of tabs) {
		const selected = tab["data-strip-entry"] === view;
		assert.equal(tab.role, "tab");
		assert.equal(tab["aria-selected"], selected);
		assert.equal(tab.tabIndex, selected ? 0 : -1, "only the selected tab is in the Tab order");
		assert.equal(tab["aria-controls"], String(tab.id).replace(/-tab$/, "-panel"));
		assert.equal(tab["aria-haspopup"], undefined, "a tab opens no dialog");
	}
	const openers = workflowButtons.filter((button) => button["data-dialog-opener"]);
	assert.deepEqual(openers.map((button) => button["data-dialog-opener"]), ["social", "schema"]);
	for (const button of openers) {
		assert.equal(button.disabled, !previewReady);
		assert.equal(button["aria-haspopup"], "dialog");
		assert.equal(button.role, undefined);
		assert.equal(button.title, previewReady ? `Opens Edit SEO on the ${button["data-dialog-opener"] === "social" ? "Social" : "Schema"} tab` : "Available once the preview loads");
		assert.equal(typeof button.onClick, "function");
		const name = button["data-dialog-opener"] === "social" ? "Social" : "Schema";
		const children = React.Children.toArray(button.children as React.ReactNode);
		assert.equal(children.length, 2, name + " keeps only its left semantic icon and label");
		assert.ok(React.isValidElement(children[0]));
		assert.equal(children[0].type, name === "Social" ? previewIcons.ShareNetwork : previewIcons.TreeStructure);
		assert.equal((children[0].props as Record<string, unknown>)["aria-hidden"], "true");
		const openerHtml = html.match(new RegExp(`<button[^>]*data-dialog-opener="${button["data-dialog-opener"]}"[^>]*>([\\s\\S]*?)</button>`))?.[1];
		assert.ok(openerHtml, name);
		assert.equal((openerHtml.match(/<svg\b/g) ?? []).length, 1, name + " has no second trailing icon");
		assert.ok(openerHtml.includes(`<span>${name}</span>`), name + " keeps its visible label");
		assert.doesNotMatch(openerHtml, /opener-glyph/);
	}
	assert.ok(html.indexOf('data-preview-kind="search"') < 0 || html.indexOf('data-preview-kind="search"') < html.indexOf('data-dialog-opener="social"'),
		"the openers sit under the search preview");
	assert.ok(html.indexOf('data-dialog-opener="schema"') < html.indexOf('role="tablist"'), "the openers precede the section tabs");
	assert.equal(html.includes('data-advanced-settings="true"'), previewReady && view === "advanced");
	const analysisSections = workflowSections.filter((section) => section["data-editor-view"] === "analysis");
	assert.equal(analysisSections.length, 1, "the Analysis subtree stays mounted on either section");
	assert.equal(analysisSections[0].hidden, view !== "analysis");
	assert.equal(analysisSections[0].role, "tabpanel");
	const advancedSections = workflowSections.filter((section) => section["data-editor-view"] === "advanced");
	assert.equal(advancedSections.length, 1, "the Advanced panel named by its tab is always present");
	assert.equal(advancedSections[0].hidden, view !== "advanced");
	assert.equal(advancedSections[0].children === null, view !== "advanced", "Advanced controls mount only while selected");
	assert.equal((html.match(/shipit-seo-native-panel__summary"/g) ?? []).length, 1);
	assert.equal(workflowPreviews.length, previewReady ? 1 : 0);
	if (previewReady) {
		assert.equal(workflowPreviews[0].dialogRequest, null, "mounting never queues a dialog");
		assert.equal(workflowPreviews[0].onSocialSave, workflowCallbacks.social);
	}
};
const ownershipSlot = React.createElement("p", { "data-ownership-guidance": true }, "Saved metadata ownership guidance");
for (const preview of [reviewPreview, null]) {
	for (const view of ["analysis", "advanced"] as const) {
		const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null, preview, advancedNotice: ownershipSlot }, view);
		assertWorkflow(html, preview !== null, view);
		assert.equal(html.includes("Saved metadata ownership guidance"), view === "advanced");
		const advancedContent = workflowSections.find((section) => section["data-editor-view"] === "advanced")?.children as React.ReactElement<{ children: unknown[] }> | null;
		if (advancedContent) assert.equal(advancedContent.props.children[0], ownershipSlot, "the same read-only notice is passed through without new reads");
	}
}
const keywordDraftHtml = (keywordInputValue: string) =>
	renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null, preview: reviewPreview, keywordInputValue });
assert.ok(keywordDraftHtml("\u{1f355}").includes("Use letters or numbers. Symbols alone cannot be found in the text."),
	"a keyword with nothing to match is refused before it is added");
assert.ok(!keywordDraftHtml("pizza oven").includes("Symbols alone"));
assert.match(savedPanelSource, /!keyword \|\|\s*!seoKeywordIdentity\(keyword\) \|\|/, "the add handler refuses the same keyword");

// A host autosave changes the entry revision and the preview query key. The panel, the dialog and the native draft
// keep their collection, entry and locale identity, and the retained preview keeps SearchPreview mounted meanwhile.
{
	const savedEntry = { id: "entry", type: "posts", locale: "en", _rev: btoa("5:fixture"),
		seo: { title: null, description: null, image: null, canonical: null, noIndex: false }, data: {} };
	const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null, preview: reviewPreview,
		previewLoading: true, savedEntry });
	assertWorkflow(html, true, "analysis");
	assert.equal(workflowPreviews.length, 1, "SearchPreview, which owns the open dialog and its draft, stays mounted while the newer version loads");
	assert.equal(workflowPreviews[0].previewUpdating, true);
	assert.equal(workflowPreviews[0].savedEntry, savedEntry, "the host entry reaches the native draft as a guard observation");
	assert.doesNotMatch(html, /Loading resolved preview/);
}
assert.match(savedPanelSource, /retainEntryPreview\(previewRetention\.current, JSON\.stringify\(\[ref, previewLocale\]\),/,
	"the shown preview's identity is the entry and locale, never the saved version");
assert.match(savedPanelSource, /preview=\{shownPreview\.shown\?\.preview \?\? null\}\s*savedEntry=\{entry\}/);
assert.match(savedPanelSource, /previewObservation=\{shownPreview\.shown\?\.observation\}/);
assert.match(source, /<SavedSeoEditorPanel\s*key=\{entryRef\(context\.collection, context\.entry\.id\) \+ ":" \+ \(context\.locale \?\? context\.entry\.locale \?\? ""\)\}/,
	"the panel is keyed by collection, entry id and locale only");
assert.doesNotMatch(source.slice(source.indexOf("function SeoEditorPanel("), source.indexOf("export function SeoEditorPanelRoot(")), /updatedAt|_rev|savedVersion\)?\s*\+/,
	"no revision reaches the panel key");
assert.match(source, /setDialogRequest\(null\);\s*\}, \[preview\?\.content\.ref, locale\]\);/, "only an entry or locale change resets the dialog request");
assert.match(source, /useNativeSeoEditor\(\{ preview, locale: locale \?\? null, open: editing, entry: savedEntry \?\? undefined, onConfirmed: onPreviewRetry \}\)/);
// A confirmed save removes the focused button; focus moves to the confirmation inside the dialog, not the page body.
assert.match(source, /const nativeSaveStep = `\$\{nativePhase\}:\$\{nativeBusy\}`;/);
assert.match(source, /active !== owner\.body && active\.getAttribute\("role"\) !== "dialog" && !active\.matches\(":disabled"\)/,
	"a control disabled by the save step counts as lost focus before the browser moves it to the body");
assert.match(source, /React\.useLayoutEffect\(\(\) => \{\n\t\tconst previous = previousSaveStep\.current;[\s\S]{0,900}?restore\(\);\n\t\treturn afterPaint\(restore\);/,
	"focus returns in the same commit, with a later pass for a status that renders after it");
assert.match(source, /dialog\?\.querySelector<HTMLElement>\("\[data-native-seo-status\]"\) \?\?\s*dialog\?\.querySelector<HTMLElement>\("\[data-dialog-footer\] button:not\(:disabled\)"\)/);
assert.match(source, /const nativeFooter = dialogView !== "schema" \|\| nativeSeoSaveOutstanding\(nativeEditor\) \|\| nativePhase === "confirmed";/,
	"the confirmation stays visible on the tab the save was made from until the next edit");


for (const [name, state, expected] of [
	["off", { scoringEnabled: false, assessmentConfigured: false }, "Choose an assessment profile"],
	["pending consent", { scoringEnabled: false, assessmentConfigured: false }, "Choose an assessment profile"],
	["unconfigured", { scoringEnabled: true, assessmentConfigured: false }, "Choose an assessment profile"],
	["no score", { scoringEnabled: true, assessmentConfigured: true, analysisAdmitted: true }, "Not analyzed"],
	["unavailable", { scoringEnabled: false, scoringUnknown: true, assessmentConfigured: false, storedUnavailable: true }, "SEO settings unavailable"],
] as const) {
	for (const view of ["analysis", "advanced"] as const) {
		const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null,
			unavailableContent: React.createElement(workflowProduction.UnavailableAnalysisProbe, { ...state, history: true }),
		}, view);
		assertWorkflow(html, true, view);
		assert.doesNotMatch(html, /shipit-seo-native-panel__ring-progress|shipit-seo-native-panel__groups/,
			name + " invents no current score or checklist");
		assert.match(html, /id="[^"]*-focus-keyword"/, name + " keeps its independent keyword area");
		if (view === "analysis") {
			assert.ok(html.includes(expected), name);
			if (name !== "no score") assert.ok(html.includes("Last saved SEO score: 42/100"), name + " retains qualified history");
			if (name === "unavailable") assert.ok(html.includes("Retry score"));
		} else {
			assert.ok(html.includes(expected), "availability details remain in the hidden Analysis subtree");
			assert.match(html, /data-editor-view="analysis" hidden=""/);
		}
	}
}
for (const [name, score, current] of [
	["current", verifiedSelection.score, true], ["stale", mismatchSelection.score, false],
	["unverified", unverifiedSelection.score, false],
] as const) {
	assert.ok(score);
	for (const view of ["analysis", "advanced"] as const) {
		const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score }, view);
		assertWorkflow(html, true, view);
		assert.equal(html.includes('aria-label="SEO checks"'), current, name + " keeps its checklist in the retained Analysis subtree");
		assert.equal(html.includes('class="shipit-seo-native-panel__ring-progress"'), false, `${name}: a body-limited assessment has no numeric badge`);
		assert.match(html, /Run without saving/);
	}
}
let localFix: ((check: SeoContentCheck) => void) | null = null;
const localWorkflow = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null,
	keywordEditorVisible: true, renderLocalAnalysis: (onFix: (check: SeoContentCheck) => void) => {
		localFix = onFix;
		return React.createElement("p", { "data-local-review": true }, "Local saved-entry review");
	},
});
assertWorkflow(localWorkflow, true, "analysis");
assert.match(localWorkflow, /id="[^"]*-focus-keyword"/);
assert.match(localWorkflow, /data-local-review="true"/);
assert.equal(typeof localFix, "function");
assert.doesNotMatch(localWorkflow, /shipit-seo-native-panel__ring-progress|Run without saving/);
assert.match(localWorkflow, /<strong>Not checked<\/strong>/);
{
	const loadingWorkflow = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null, analysisLoading: true,
		renderLocalAnalysis: () => null });
	assert.match(loadingWorkflow, /<strong>Loading checks\.\.\.<\/strong>/, "inputs still being read are not reported as Not checked");
	assert.match(loadingWorkflow, /The saved content and settings are being read\./);
	assert.match(loadingWorkflow, /aria-label="No SEO score"/);
	assert.match(savedPanelSource, /const basicChecksLoading = shownBasic === null &&\n\t\t\(previewQuery\.isPending \|\| profileQuery\.isPending \|\| assessmentQuery\.isPending \|\| basicInputsRefreshing\);/);
	assert.match(savedPanelSource, /<span>\{basicChecksLoading \? "Loading the saved content and settings\.\.\." : basicAnalysis\.state === "unavailable" \? basicAnalysis\.reason : null\}<\/span>/,
		"a cached preview read again on return shows loading, not the reload instruction");
}
const localSavedEntry = {
	id: "action-owner", slug: "checked-entry-slug", updatedAt: "2026-10-17T10:00:00.000Z",
	data: { title: reviewSavedTitle, focus_keyword: "dental implants", content: [{ _type: "block", style: "normal", children: [{ _type: "span", text: actionInput.body }] }] },
	seo: { title: reviewSavedTitle, description: reviewSavedDescription, noIndex: false },
};
const localSnapshot = createSavedContentSnapshot("posts:action-owner", localSavedEntry);
const localPreview: SeoAdminEntryPreview = {
	...reviewPreview, sourceKind: "saved-snapshot", sourceVersion: localSnapshot.sourceVersion,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: localSavedEntry.updatedAt,
	content: { ...reviewPreview.content, collection: "posts" },
	sources: { title: "core-seo", description: "template", canonical: "core-seo", socialTitle: "content", socialDescription: "template", image: "site-default" },
	social: { title: reviewSavedTitle, description: reviewSavedDescription, image: null, fallbackTitle: reviewSavedTitle, fallbackDescription: reviewSavedDescription,
		override: { title: null, description: null, updatedAt: null }, editing: { state: "ready", snapshot: { ref: "posts:action-owner", revision: null, override: null } } },
	entryNoindex: false, canonicalValidation: { status: "matches", canonical: reviewPreview.search.url, expectedPath: "/checked-entry-slug" },
	localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: false,
		currentLocale: "en", defaultLocale: "en", translationGroup: null, discoveredLocales: ["en"], alternates: [], xDefaultLocale: "en", issues: [] },
	schemaTypes: [], outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	ownership: { status: "current", reason: null, sourceVersion: localSnapshot.sourceVersion, locale: "en", record: null,
		fields: SEO_ADMIN_OWNERSHIP_FIELDS.map((field) => ({ field, state: "not-shadowed", core: field === "noIndex" ? false : null,
			legacy: null, effective: field === "noIndex" ? false : null, effectiveSource: "core-seo", social: null })),
		unsupportedDirectives: { state: "none", tokens: [] } },
};
// Exercise the manager's actual saved-scope guards and current-output markup.
// The query transport is controlled here; browser layout and focus are not measured.
const schemaManagerStatement = productionDeclaration("EntrySchemaManager");
assert.ok(ts.isFunctionDeclaration(schemaManagerStatement) && schemaManagerStatement.body);
const schemaManagerDeclaration: ts.FunctionDeclaration = schemaManagerStatement;
function schemaManagerBinding(name: string): string {
	const statement = schemaManagerDeclaration.body!.statements.find((candidate) =>
		ts.isVariableStatement(candidate) && candidate.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
	assert.ok(statement, name);
	return statement.getText(parsedSource);
}
const schemaScopeGuards = ["!switchSettling && !confirmedSnapshot", "!switchSettling && (listQuery.isPending", "!switchSettling && (listQuery.isError"].map((prefix) => {
	const guard = schemaManagerDeclaration.body!.statements.find((candidate) => ts.isIfStatement(candidate) && candidate.expression.getText(parsedSource).startsWith(prefix));
	assert.ok(guard, prefix);
	assert.doesNotMatch(guard.getText(parsedSource), /dispatch\(|store\./, "a masked read never closes or rewrites the separate schema draft");
	return guard.getText(parsedSource);
});
let currentSchemaOutput: ts.JsxElement | undefined;
function findCurrentSchemaOutput(node: ts.Node): void {
	if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsedSource) === "details" &&
		node.openingElement.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText(parsedSource) === "ref" && property.initializer?.getText(parsedSource) === "{currentOutputRef}")) {
		assert.equal(currentSchemaOutput, undefined);
		currentSchemaOutput = node;
	}
	ts.forEachChild(node, findCurrentSchemaOutput);
}
findCurrentSchemaOutput(schemaManagerDeclaration);
assert.ok(currentSchemaOutput);
interface SchemaGraphQueryFixture {
	queryKey: unknown[]; enabled: boolean; staleTime: number; refetchOnMount: string;
	queryFn: (context: { signal: AbortSignal }) => Promise<{ items: unknown[]; sourceVersion: string; locale: string | null }>;
}
let schemaGraphOptions: SchemaGraphQueryFixture | null = null;
let schemaGraphRead: Record<string, unknown> = {};
const schemaGraphRequests: Array<{ ref: string; options: Record<string, unknown> }> = [];
const schemaScopeProduction = compileProduction(
	productionDeclaration("entrySchemaSavedSnapshot").getText(parsedSource) +
	"\nfunction SchemaPreviewScopeProbe({ preview, savedSnapshot, locale = null, listQuery, directivesQuery, onPreviewRetry, switchSettling = false, shownRead = { current: null } }) {\nconst ref = preview.content.ref;\n" +
	["confirmedSnapshot", "graphsQuery", "listedRead", "graphReadCurrent"].map(schemaManagerBinding).join("\n") + "\n" + schemaScopeGuards.join("\n") +
	"\n" + ["held", "listed", "graphs"].map(schemaManagerBinding).join("\n") + "\nconst existingGraphs = graphs; const currentOutputRef = { current: null };\nreturn (" + currentSchemaOutput.getText(parsedSource) + ");\n}\nmodule.exports = { SchemaPreviewScopeProbe, entrySchemaSavedSnapshot };", {
		React, savedSnapshotMatches,
		useQuery: (options: SchemaGraphQueryFixture) => { schemaGraphOptions = options; return schemaGraphRead; },
		fetchSeoEntrySchemaPreview: async (ref: string, options: Record<string, unknown>) => { schemaGraphRequests.push({ ref, options }); return { success: true, items: [] }; },
		classifyEntrySchemaRequestError: () => "unknown", ENTRY_SCHEMA_DENIED_MESSAGE: "denied",
		CodeBlock: ({ code }: { code: string }) => React.createElement("pre", null, code),
	},
) as { SchemaPreviewScopeProbe: React.ComponentType<Record<string, unknown>>; entrySchemaSavedSnapshot: (preview: SeoAdminEntryPreview, snapshot: unknown, locale: string | null) => unknown };
const schemaReadyList = { data: { success: true, entry: { locale: "en" } }, isPending: false, isError: false };
const schemaReadyDirectives = { isPending: false, isError: false };
const schemaDraftGraph = { id: "preset:blogPosting", name: "BlogPosting", graph: { "@type": "BlogPosting", headline: "Current saved draft", "@id": "https://example.invalid/posts/saved-draft#article" } };
const readySchemaRead = { data: { items: [schemaDraftGraph], sourceVersion: localSnapshot.sourceVersion, locale: "en" },
	isPending: false, isFetching: false, isError: false, isFetchedAfterMount: true };
function renderSchemaScope(preview: SeoAdminEntryPreview = localPreview, savedSnapshot: unknown = localSnapshot, listQuery = schemaReadyList, switchSettling = false,
	shownRead: { current: unknown } = { current: null }): string {
	return renderToStaticMarkup(React.createElement(schemaScopeProduction.SchemaPreviewScopeProbe, { preview, savedSnapshot, locale: "en", listQuery,
		directivesQuery: schemaReadyDirectives, onPreviewRetry: () => undefined, switchSettling, shownRead }));
}
schemaGraphRead = readySchemaRead;
const schemaCurrentHtml = renderSchemaScope();
assert.match(schemaCurrentHtml, /Current schema output/);
assert.match(schemaCurrentHtml, /Current saved draft/);
assert.match(schemaCurrentHtml, /Publication dates come from stored entry metadata and may change on publish/);
const currentSchemaQuery = schemaGraphOptions as unknown as SchemaGraphQueryFixture;
assert.deepEqual(currentSchemaQuery.queryKey, ["shipit-seo-entry-schema-graphs", localPreview.content.ref, localSnapshot.sourceVersion, "en"]);
assert.equal(currentSchemaQuery.enabled, true);
assert.equal(currentSchemaQuery.staleTime, 0);
assert.equal(currentSchemaQuery.refetchOnMount, "always");
const schemaSignal = new AbortController().signal;
assert.deepEqual(await currentSchemaQuery.queryFn({ signal: schemaSignal }), { items: [], sourceVersion: localSnapshot.sourceVersion, locale: "en" });
assert.deepEqual(schemaGraphRequests, [{ ref: localPreview.content.ref, options: { signal: schemaSignal, snapshot: localSnapshot, savedVersion: localSnapshot.sourceVersion, locale: "en" } }]);
for (const [preview, snapshot] of [
	[localPreview, null], [localPreview, { ...localSnapshot, ref: "posts:other" }],
	[{ ...localPreview, sourceVersion: "old" }, localSnapshot], [{ ...localPreview, sourceKind: undefined }, localSnapshot],
	[{ ...localPreview, ownership: undefined }, localSnapshot],
	[{ ...localPreview, ownership: { ...localPreview.ownership!, sourceVersion: "old" } }, localSnapshot],
	[{ ...localPreview, ownership: { ...localPreview.ownership!, locale: "fr" } }, localSnapshot],
] as const) {
	schemaGraphRead = readySchemaRead;
	const html = renderSchemaScope(preview, snapshot);
	assert.match(html, /Confirm the saved entry/);
	assert.match(html, /Reload saved entry/);
	assert.doesNotMatch(html, /Current schema output|Current saved draft/);
	const unknownQuery = schemaGraphOptions as unknown as SchemaGraphQueryFixture;
	assert.equal(unknownQuery.enabled, false);
}
for (const read of [
	{ ...readySchemaRead, data: { ...readySchemaRead.data, sourceVersion: "older" } },
	{ ...readySchemaRead, data: { ...readySchemaRead.data, locale: "fr" } },
	{ ...readySchemaRead, isFetchedAfterMount: false }, { ...readySchemaRead, isError: true },
]) {
	schemaGraphRead = read;
	const html = renderSchemaScope();
	assert.match(html, /could not be loaded/);
	assert.doesNotMatch(html, /Current schema output|Current saved draft/);
}
schemaGraphRead = { ...readySchemaRead, isFetching: true };
assert.match(renderSchemaScope(), /Loading this entry/);
assert.doesNotMatch(renderSchemaScope(), /Current schema output|Current saved draft/);
schemaGraphRead = readySchemaRead;
assert.doesNotMatch(renderSchemaScope(localPreview, localSnapshot, { ...schemaReadyList, data: { ...schemaReadyList.data, entry: { locale: "fr" } } }), /Current schema output|Current saved draft/);
assert.match(savedPanelSource, /savedSnapshot=\{basicPreviewReady \? savedSnapshot : null\}/, "a core Save withdraws the retained schema input until its current preview is verified");
// A default switch save refreshes the preview, which withdraws the saved snapshot for a moment; the panel keeps the read it showed.
schemaGraphRead = readySchemaRead;
assert.match(renderSchemaScope(localPreview, null), /Confirm the saved entry/, "control: an unconfirmed entry without a switch refresh shows the confirm state");
const heldGraph = { ...schemaDraftGraph, graph: { ...schemaDraftGraph.graph, headline: "Held earlier read" } };
const heldRead = { current: { listed: schemaReadyList.data, graphs: [heldGraph] } };
for (const [label, read, snapshot] of [
	["unconfirmed", { isPending: true, isFetching: false, isError: false, isFetchedAfterMount: false, data: undefined }, null],
	["refetching", { ...readySchemaRead, isFetching: true }, localSnapshot],
] as const) {
	schemaGraphRead = read;
	const held = renderSchemaScope(localPreview, snapshot, schemaReadyList, true, heldRead);
	assert.doesNotMatch(held, /Confirm the saved entry|Loading this entry/, "a switch refresh keeps the panel while " + label);
	assert.match(held, /Held earlier read/, "the panel shows the read it held while " + label);
	assert.doesNotMatch(held, /Current saved draft/, "the live read does not replace the held one while " + label);
}
schemaGraphRead = readySchemaRead;
{
	const settling = compileProduction("function probe({ switchRefresh, shownRead, presetToggle, previewRefreshing, listQuery, graphsQuery, directivesQuery }) {\n" +
		schemaManagerBinding("switchSettling") + "\nreturn switchSettling;\n}\nmodule.exports = { probe };", {}) as { probe: (state: Record<string, unknown>) => boolean };
	const quiet = { isFetching: false, isError: false };
	const base = { switchRefresh: { presetKey: "faq", disabled: true }, shownRead: { current: {} }, presetToggle: { isPending: false }, previewRefreshing: false,
		listQuery: quiet, graphsQuery: quiet, directivesQuery: quiet };
	assert.equal(settling.probe(base), false, "nothing is refreshing, so the hold ends");
	for (const busy of [{ presetToggle: { isPending: true } }, { previewRefreshing: true }, { listQuery: { ...quiet, isFetching: true } },
		{ graphsQuery: { ...quiet, isFetching: true } }, { directivesQuery: { ...quiet, isFetching: true } }]) {
		assert.equal(settling.probe({ ...base, ...busy }), true, "a refresh after the switch holds the panel: " + JSON.stringify(busy));
	}
	assert.equal(settling.probe({ ...base, previewRefreshing: true, switchRefresh: null }), false, "only a switch save holds the panel");
	assert.equal(settling.probe({ ...base, previewRefreshing: true, shownRead: { current: null } }), false, "nothing is held before a read was shown");
	assert.equal(settling.probe({ ...base, previewRefreshing: true, graphsQuery: { isFetching: false, isError: true } }), false, "a failed read is shown, not held");
}
assert.match(source, /<EntrySchemaManager preview=\{preview\} savedSnapshot=\{savedSnapshot\} locale=\{locale\} onPreviewRetry=\{onPreviewRetry\}/);

// --- Schema in use: list first, Add after it, per-entry default switches last and collapsed ---
const schemaManagerReturn = schemaManagerDeclaration.body!.statements.filter(ts.isReturnStatement).at(-1)!.getText(parsedSource);
const inUseAt = schemaManagerReturn.indexOf(">Schema in use</h3>");
const addAt = schemaManagerReturn.indexOf('className="shipit-seo-entry-schema__add"');
const defaultsAt = schemaManagerReturn.indexOf("Defaults for this entry (");
assert.ok(inUseAt > 0 && inUseAt < addAt && addAt < defaultsAt, "Schema in use leads, then Add schema and the template picker, then the defaults disclosure");
assert.ok(schemaManagerReturn.indexOf("{addButton}") > addAt && schemaManagerReturn.indexOf("<EntrySchemaTemplatePicker") > addAt);
assert.ok(schemaManagerReturn.indexOf("{savingNote}") > addAt && schemaManagerReturn.indexOf("{savingNote}") < defaultsAt, "the saving explanation is one helper line under Add");
assert.equal((schemaManagerReturn.match(/<Switch\b/g) ?? []).length, 1);
assert.ok(schemaManagerReturn.indexOf("<Switch") > defaultsAt, "per-entry default switches appear only inside the disclosure");
const inUseButtons: Array<Record<string, any>> = [];
const inUseOpened: Array<[string, string]> = [];
const inUseProbe = compileProduction(
	productionDeclaration("SOURCE_BADGES").getText(parsedSource) +
	"\nfunction InUseProbe({ rows, expandedId, setExpandedId, listed, editor, confirming, state, locked, openStoredSchema, renderForm, renderRemovalConfirmation }) {\n" +
	["manageHref", "reviewToggle", "resolvedReview", "sourceBadge", "manageLink", "renderInUseRow"].map(schemaManagerBinding).join("\n") +
	"\nreturn (<ul>{rows.map(renderInUseRow)}</ul>);\n}\nmodule.exports = { InUseProbe };", {
		React, SEO_WORKSPACE_URL: "/_emdash/admin/plugins/shipit-seo/seo", ENTRY_SCHEMA_SOURCE_LABELS, entrySchemaOutputState,
		entrySchemaEditorDetached: () => false,
		Badge: (props: { variant: string; appearance?: string; children: string }) => React.createElement("span", { "data-badge": props.variant, "data-appearance": props.appearance }, props.children),
		Button: (props: Record<string, any>) => {
			inUseButtons.push(props);
			return React.createElement("button", { type: "button", "aria-label": props["aria-label"], "aria-expanded": props["aria-expanded"], disabled: props.disabled });
		},
		CodeBlock: ({ code }: { code: string }) => React.createElement("pre", null, code),
		Eye: () => React.createElement("i", { "data-icon": "eye" }), EyeSlash: () => React.createElement("i", { "data-icon": "eye-slash" }),
		PencilSimple: () => null, Trash: () => null, ArrowSquareOut: () => null,
	},
) as { InUseProbe: React.ComponentType<Record<string, unknown>> };
const inUseSchema = { id: "entry-cccccccccccccccccccc", name: "Launch FAQ", json: "{}", enabled: true, types: ["FAQPage"], valid: true, validationError: null, createdAt: "", updatedAt: "" };
const inUseGraph = (id: string, patch: Partial<SeoAdminEntrySchemaGraph> = {}): SeoAdminEntrySchemaGraph => ({ id, source: "custom", presetKey: null, name: "Launch FAQ", types: ["FAQPage"], disabled: false,
	emitted: true, suppressedReason: null, conflictId: null, replacesCore: false, graph: { "@type": "FAQPage", name: id }, ...patch });
const inUseRows = entrySchemaInUseRows({ items: [inUseSchema], collectionLabel: "Posts", outputEnabled: true,
	inherited: [{ id: "site-faq", name: "Site FAQ", owner: "site", scope: "global", enabled: true, types: ["FAQPage"], valid: true }],
	graphs: [inUseGraph("preset:blogPosting", { source: "preset", presetKey: "blogPosting", name: "Article", types: ["Article"] }),
		inUseGraph(`custom:${inUseSchema.id}`), inUseGraph("custom:site-faq", { name: "Site FAQ" })] });
const renderInUse = (props: Record<string, unknown> = {}) => {
	inUseButtons.length = 0;
	return renderToStaticMarkup(React.createElement(inUseProbe.InUseProbe, {
		rows: inUseRows, expandedId: null, setExpandedId: () => undefined, listed: { outputEnabled: true, entry: { status: "published" }, items: [inUseSchema] },
		editor: null, confirming: null, state: {}, locked: false, openStoredSchema: (id: string, action: string) => { inUseOpened.push([id, action]); },
		renderForm: () => React.createElement("form", null), renderRemovalConfirmation: () => React.createElement("div", { "data-confirm": "inline" }), ...props,
	}));
};
const inUseHtml = renderInUse();
const inUseItems = [...inUseHtml.matchAll(/<li data-source="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => ({ source: match[1], html: match[2] }));
assert.deepEqual(inUseItems.map((item) => item.source), ["entry", "content-type", "shared"], "an Article default and one entry schema show their own rows with sources");
assert.match(inUseItems[0].html, /<span data-badge="info">This entry<\/span>/);
assert.match(inUseItems[1].html, /<span data-badge="secondary">Content type default<\/span>/);
assert.match(inUseItems[2].html, /<span data-badge="outline">Shared<\/span>/);
// Shared and Site use different badge styles, and every row keeps its badge in one slot before one actions group.
const productionSourceBadges = compileProduction(productionDeclaration("SOURCE_BADGES").getText(parsedSource) + "\nmodule.exports = { SOURCE_BADGES };", {})
	.SOURCE_BADGES as Record<string, { variant: string; appearance?: string }>;
assert.notDeepEqual(productionSourceBadges.shared, productionSourceBadges.site, "Shared and Site badges look different");
assert.equal(productionSourceBadges.site!.appearance, undefined, "Site is a filled badge, not a second outline");
for (const item of inUseItems) {
	assert.match(item.html, /^<strong>[\s\S]*?<\/strong><span class="shipit-seo-entry-schema__source"><span data-badge="[a-z]+">[^<]+<\/span><\/span><span class="shipit-seo-entry-schema__row-actions">/,
		"the source badge sits in its own slot directly after the name, then one actions group");
}
assert.match(inUseItems[0].html, /aria-label="Edit Launch FAQ"[\s\S]*aria-label="Remove Launch FAQ"/);
assert.doesNotMatch(inUseItems[0].html, /Manage in Schema/);
for (const item of inUseItems.slice(1)) {
	assert.doesNotMatch(item.html, /aria-label="(?:Edit|Remove) /, "default and shared rows cannot be edited or removed from the entry");
	assert.match(item.html, /aria-label="Manage in Schema: [^"]+"/);
}
assert.match(inUseItems[1].html, /href="\/_emdash\/admin\/plugins\/shipit-seo\/seo\?view=schema"/);
assert.match(inUseItems[2].html, /href="\/_emdash\/admin\/plugins\/shipit-seo\/seo\?view=schema#custom-schema-title"/);
assert.match(inUseItems[1].html, /Article<small>Posts<\/small>/, "a default names its type once and its content type scope");
assert.match(inUseItems[2].html, /<small>FAQPage, every page<\/small>/);
assert.match(inUseItems[0].html, /<small>FAQPage, only this entry<\/small>/);
assert.equal((inUseHtml.match(/aria-label="Show JSON-LD for [^"]+" aria-expanded="false"/g) ?? []).length, 3, "every row has a collapsed view-JSON toggle");
assert.doesNotMatch(inUseHtml, /<pre>/, "raw JSON stays hidden until asked for");
let expandedRequest: string | null = null;
renderInUse({ setExpandedId: (value: string | null) => { expandedRequest = value; } });
inUseButtons.find((props) => props["aria-label"] === "Show JSON-LD for Article")!.onClick();
assert.equal(expandedRequest, "preset:blogPosting");
const expandedHtml = renderInUse({ expandedId: "preset:blogPosting" });
assert.match(expandedHtml, /aria-label="Hide JSON-LD for Article" aria-expanded="true"/);
assert.equal((expandedHtml.match(/<pre>/g) ?? []).length, 1);
assert.match(expandedHtml, /&quot;name&quot;: &quot;preset:blogPosting&quot;/);
renderInUse();
inUseButtons.find((props) => props["aria-label"] === "Remove Launch FAQ")!.onClick();
assert.deepEqual(inUseOpened, [[inUseSchema.id, "remove"]], "Remove reads the exact record before its inline confirmation");
const confirmingHtml = renderInUse({ confirming: { ...inUseSchema, revision: "rev" } });
assert.match(confirmingHtml, /<li data-source="entry"[^>]*>(?:(?!<\/li>)[\s\S])*data-confirm="inline"/, "the removal confirmation renders inside the entry row");
assert.equal((confirmingHtml.match(/data-confirm="inline"/g) ?? []).length, 1);
assert.match(source, /invalidateQueries\(\{ queryKey: \["shipit-seo-entry-schema-graphs", ref\] \}\)/, "schema writes invalidate all versions of this entry's prediction");

const localAnalysis = resolveEditorBasicAnalysis({ preview: localPreview, snapshot: localSnapshot, ref: "posts:action-owner", sourceVersion: localSnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true, publicationStatus: "draft" });
if (localAnalysis.state !== "ready") throw new Error(localAnalysis.reason);
assert.equal(localAnalysis.state, "ready");
assert.equal(Object.hasOwn(localAnalysis.result, "freshness"), false);
assert.equal(Object.hasOwn(localAnalysis.result, "persistence"), false);
const passChecklist = (_onFix: unknown, checklist: React.ReactNode) => checklist;
const localHtml = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, preview: localPreview, savedSnapshot: localSnapshot,
	score: null, basicAnalysis: localAnalysis, keywordsValue: localAnalysis.keywordOwnership.display, keywordsInherited: localAnalysis.keywordOwnership.inherited,
	renderLocalAnalysis: passChecklist,
});
assertWorkflow(localHtml, true, "analysis");
assert.equal(workflowPreviews[0].savedSnapshot, localSnapshot, "the real disclosure and workflow retain the same verified schema input");
assert.equal((localHtml.match(/aria-label="SEO checks"/g) ?? []).length, 1, "the browser checks fill the one checklist");
assert.ok(localHtml.includes("Add more page text to get a score."));
assert.doesNotMatch(scoreHeaderRegion(localHtml), /<dt>Profile<\/dt>|<dt>Weighted checks<\/dt>|<dl/);
const localDisplay = seoScoreDisplay(localAnalysis.result);
assert.deepEqual([localDisplay.score, localDisplay.label], [null, "Too little text to score"], "a short General entry shows a dash");
assert.ok(!localHtml.includes(`<span aria-hidden="true">${localAnalysis.result.score}</span>`), "too little text receives no numeric badge");
assert.doesNotMatch(localHtml, /out of 100|before limits|Limited to/);
assert.match(localHtml, /dental implants/);
assert.match(localHtml, /Inherited/);
assert.doesNotMatch(localHtml, /About these checks|How this assessment was calculated/);
assert.equal(seoAnalysisPresentation(localAnalysis.result).qualifier, localDisplay.qualifier);
assert.ok(localHtml.includes("Add more page text to get a score."), "the short-entry note gives one concrete next step");
assert.match(localHtml, /role="img" aria-label="No SEO score"/);
assertSimpleScopeCopy(localHtml);
const localCompactHeader = localHtml.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
assert.match(localCompactHeader, /<strong>Too little text to score<\/strong>/);
assert.match(localCompactHeader, /<span aria-hidden="true">-<\/span>/);
assert.ok(localCompactHeader.includes(`<span>${seoCheckTotalsText(contentCheckPresentation(localAnalysis.result).totals)}</span>`), "header counts are the group sums");
assert.doesNotMatch(localCompactHeader, /words of body text|Weighted|Browser checks/);
assert.doesNotMatch(localHtml, /Score details|Basic \/ General content is used because|weighted checks? not checked/);
assert.doesNotMatch(localHtml, /Stored analysis matches|Current content not checked|Run without saving/);

const tinyEntry = {
 ...localSavedEntry,
 data: { title: "test", content: [
  { _type: "block", style: "h1", children: [{ _type: "span", text: "testtesttest" }] },
  { _type: "block", style: "normal", children: [{ _type: "span", text: "testttasfassssssssssss" }] },
 ] },
 seo: { title: "test", description: "tes", noIndex: false },
};
const tinySnapshot = createSavedContentSnapshot("posts:action-owner", tinyEntry);
const tinyPreview: SeoAdminEntryPreview = { ...localPreview, sourceVersion: tinySnapshot.sourceVersion,
 search: { ...localPreview.search, title: "test", description: "tes" },
 social: { ...localPreview.social, image: "https://example.invalid/social.jpg" },
 ownership: { ...localPreview.ownership!, sourceVersion: tinySnapshot.sourceVersion },
};
const tinyAnalysis = resolveEditorBasicAnalysis({ preview: tinyPreview, snapshot: tinySnapshot,
 ref: "posts:action-owner", sourceVersion: tinySnapshot.sourceVersion, locale: "en", profile: null, profileReady: true,
 keywords: [], assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true, publicationStatus: "published" });
if (tinyAnalysis.state !== "ready") throw new Error("The saved tiny-entry control must be evaluated");
assert.equal(tinyAnalysis.result.metrics.wordCount, 2);
assert.equal(tinyAnalysis.result.calculation.earnedWeight, 48.75);
assert.equal(tinyAnalysis.result.calculation.totalWeight, 52);
assert.equal(tinyAnalysis.result.score, 94, "the raw applicable-check arithmetic stays separate from assessment readiness");
const tinySummary = seoAnalysisSummary(tinyAnalysis.result);
assert.equal(tinySummary.numericBadgeAvailable, false);
assert.ok(tinySummary.advisorySuggestions >= 2);
const tinyHtml = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, preview: tinyPreview,
 score: null, basicAnalysis: tinyAnalysis, keywordsValue: [], renderLocalAnalysis: passChecklist,
});
assert.doesNotMatch(tinyHtml, /shipit-seo-native-panel__ring-progress|<span aria-hidden="true">94<\/span>|out of 100|94\/100/);
assert.match(tinyHtml, /<strong>Too little text to score<\/strong>/);
const tinyTotals = contentCheckPresentation(tinyAnalysis.result).totals;
assert.ok(tinyTotals.suggestions >= 2);
assert.ok(tinyHtml.includes(`<span>${seoCheckTotalsText(tinyTotals)}</span>`));
assert.match(tinyHtml, /Add more page text to get a score\./);
assert.doesNotMatch(tinyHtml, /48\.75 of 52|points<\/dd>|Google score|ranking prediction|Weighted/);
assertSimpleScopeCopy(tinyHtml);
assert.match(tinyHtml, />Add keyword<\/button>/, "an unset keyword offers Add keyword on its row");
assert.match(metadataPill, />-<\/span>$/);
assert.doesNotMatch(metadataPill, /100\/100|out of 100/);

// Score arithmetic stays covered by the analyzer; the sidebar exposes only its result and scope.
const dirtyLocalHtml = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, preview: localPreview,
	score: null, basicAnalysis: localAnalysis, localKeywordsPending: true,
});
assert.match(dirtyLocalHtml.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "", /<span>Unsaved keywords<\/span>/);
assert.match(dirtyLocalHtml, /Using your keyword changes\./);
assert.match(localHtml, /shipit-seo-native-panel__keyword-chip-count/, "confirmed browser checks give the primary chip its coverage");
const localPrimaryCoverage = keywordCheckCoverage(localAnalysis.keywordOwnership.display[0], "primary", localAnalysis.result);
assert.ok(localPrimaryCoverage?.count);
assert.ok(localHtml.includes(`>${localPrimaryCoverage.count}</span>`), "the chip count is the checklist's own keyword rows");
const { seo: _localCoreSeo, ...localWithoutCoreSeo } = localSavedEntry;
const partialSnapshot = createSavedContentSnapshot("posts:action-owner", localWithoutCoreSeo);
const partialPreview: SeoAdminEntryPreview = {
	...localPreview, sourceVersion: partialSnapshot.sourceVersion,
	ownership: { ...localPreview.ownership!, status: "unknown", reason: "core-seo-unavailable", sourceVersion: partialSnapshot.sourceVersion,
		fields: localPreview.ownership!.fields.map((field) => ({ ...field, state: "unknown", reason: "core-seo-unavailable" })) },
};
const partialAnalysis = resolveEditorBasicAnalysis({ preview: partialPreview, snapshot: partialSnapshot, ref: "posts:action-owner", sourceVersion: partialSnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true, publicationStatus: "draft" });
if (partialAnalysis.state !== "partial") throw new Error("Expected real saved-body checks with core SEO disabled");
for (const property of ["score", "status", "grade", "calculation", "coverage"]) assert.equal(Object.hasOwn(partialAnalysis.result, property), false);
// Exercise the actual parent slot expressions: partial observations must reach
// the same persistent owner rather than its unavailable/retry branch.
let savedWorkflowElement: ts.JsxSelfClosingElement | undefined;
function findSavedWorkflow(node: ts.Node): void {
	if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsedSource) === "SeoAnalysisDisclosure") savedWorkflowElement = node;
	ts.forEachChild(node, findSavedWorkflow);
}
findSavedWorkflow(savedPanelDeclaration);
assert.ok(savedWorkflowElement);
function savedWorkflowExpression(name: string): string {
	const attribute = savedWorkflowElement!.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(parsedSource) === name);
	assert.ok(attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression);
	return attribute.initializer.expression.getText(parsedSource);
}
const savedVariable = (name: string) => {
	const statement = savedPanelDeclaration.body!.statements.find((item) => ts.isVariableStatement(item) &&
		item.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name));
	assert.ok(statement && ts.isVariableStatement(statement), name);
	return statement;
};
assert.equal(savedWorkflowExpression("score"), "shownScore");
const profileDraftControl = React.createElement("select", { "aria-label": "Unsaved assessment selection", defaultValue: "general" },
	React.createElement("option", { value: "article" }, "Article"), React.createElement("option", { value: "general" }, "General content"));
const basicSlotProduction = compileProduction(`function BasicSlotsProbe({ basicAnalysis, preview, score = null, keywordDirty = false, localKeywordsPending = false, basicPreviewReady = true, assessmentOpen = false, chooseCheckProfile, onAssessmentToggle = () => {}, assessmentRef }) {
	const collection = "posts"; const assessmentDisclosureOpen = assessmentOpen; const setAssessmentDisclosureOpen = onAssessmentToggle;
	const assessmentControl = profileDraftControl; const assessmentControlRef = assessmentRef ?? { current: null };
	const shownBasic = basicAnalysis;
	${savedVariable("analysisOptionsElement").getText(parsedSource)}
	${savedVariable("shownScore").getText(parsedSource)}
	return <SeoAnalysisDisclosure {...workflowProps} score={${savedWorkflowExpression("score")}} preview={preview} localKeywordsPending={localKeywordsPending}
		keywordCoverageConfirmed={${savedWorkflowExpression("keywordCoverageConfirmed")}}
		basicAnalysis={${savedWorkflowExpression("basicAnalysis")}}
		onChooseCheckProfile={${savedWorkflowExpression("onChooseCheckProfile")}}
		headerNotice={${savedWorkflowExpression("headerNotice")}}
		renderLocalAnalysis={${savedWorkflowExpression("renderLocalAnalysis")}}
		keywordsValue={basicAnalysis.keywordOwnership.display} keywordsInherited={basicAnalysis.keywordOwnership.inherited} />;
}
module.exports = { BasicSlotsProbe };`, {
	React, SeoAnalysisDisclosure: workflowProduction.SeoAnalysisDisclosure, hasCurrentEditorAnalysis,
	workflowProps, profileDraftControl, actions: null, draft: null, previewQuery: { isPending: false }, profileQuery: { isPending: false }, assessmentQuery: { isPending: false },
	retryBasicChecks: workflowCallbacks.preview, unavailableAnalysis: null,
	savedActionElement: React.createElement("button", { type: "button", "data-probe-analyze": true }, "Save analysis"),
	savedActionNotice: React.createElement("p", { "data-probe-analyze-notice": true }, "Analysis result notice"),
	analysisHelp: "Probe help for the explicit analysis.",
	storedHistory: (note: string) => React.createElement("p", { "data-stored-history": true }, note),
	keywordWriteUnconfirmed: false, assessmentDirty: false, scoringEnabled: false, scoringUnknown: false, SEO_WORKSPACE_URL: "/admin/plugins/shipit-seo/",
}) as { BasicSlotsProbe: React.ComponentType<Record<string, unknown>> };

// A saved post gets Article checks automatically while optional server analysis is off.
const shortProfileText = "Bread preparation starts with a clean work surface and a clear recipe. Measure the ingredients before mixing so each step is easy to follow. Bread dough needs time to rest before shaping. Keep notes about temperature and timing for the next batch. Allow the bread to cool before slicing, then store it carefully and share the result with friends at the table today.".split(" ").slice(0, 63).join(" ");
const shortProfileSnapshot = createSavedContentSnapshot("posts:action-owner", { ...localSavedEntry, data: { ...localSavedEntry.data,
	content: [{ _type: "block", style: "normal", children: [{ _type: "span", text: shortProfileText }] }],
} });
const shortProfilePreview: SeoAdminEntryPreview = { ...localPreview, sourceVersion: shortProfileSnapshot.sourceVersion,
	ownership: { ...localPreview.ownership!, sourceVersion: shortProfileSnapshot.sourceVersion },
};
const shortProfileInput = { preview: shortProfilePreview, snapshot: shortProfileSnapshot, ref: "posts:action-owner", sourceVersion: shortProfileSnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, keywords: ["bread"], assessmentReady: true, publicationStatus: "draft" };
const unconfiguredShort = resolveEditorBasicAnalysis({ ...shortProfileInput, assessment: { state: "unconfigured", collection: "posts", revision: null } });
if (unconfiguredShort.state !== "ready") throw new Error("Default browser checks do not require a saved assessment profile");
assert.equal(unconfiguredShort.profileSource, "default");
assert.equal(unconfiguredShort.profileLabel, "Article");
assert.equal(unconfiguredShort.result.metrics.wordCount, 63);
assert.deepEqual(unconfiguredShort.result.assessmentProfile, { profile: "article", version: 1 });
const defaultShortDisplay = seoScoreDisplay(unconfiguredShort.result);
assert.notEqual(defaultShortDisplay.score, null, "the single-entry default has a numeric browser score");
assert.ok(unconfiguredShort.result.score <= 70);
assert.equal(unconfiguredShort.result.checks.find((check) => check.id === "keyword-repetition")?.basis, "not-applicable");
const generalShort = resolveEditorBasicAnalysis({ ...shortProfileInput, assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 } });
const articleShort = resolveEditorBasicAnalysis({ ...shortProfileInput, assessment: { state: "configured", collection: "posts", revision: "article-profile", profile: "article", version: 1 } });
if (generalShort.state !== "ready" || articleShort.state !== "ready") throw new Error("Explicit check profiles remain available");
assert.ok(articleShort.result.score <= 70, "a short Article cannot earn a misleading high score");
assert.match(renderHeader(null, { analysis: generalShort }), /General content checks\./);
assert.match(renderHeader(null, { analysis: articleShort }), /Article checks\./);
const currentGeneralShort = { ...metadataOnlyScore, ...generalShort.result, freshness: "current" as const };
assert.equal((headerProduction.editorAnalysisSource(currentGeneralShort, generalShort) as { kind: string }).kind, "stored", "configured verified analysis retains source preference");
assert.equal((headerProduction.editorAnalysisSource({ ...currentGeneralShort, persistence: "session" }, generalShort) as { kind: string }).kind, "session");
for (const stored of [null, currentGeneralShort, { ...currentGeneralShort, persistence: "session" }, { ...currentGeneralShort, scoreVersion: SEO_SCORE_VERSION - 1 }, { ...currentGeneralShort, freshness: "stale" }]) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: unconfiguredShort, preview: shortProfilePreview, score: stored,
		chooseCheckProfile: () => undefined });
	assert.match(html, /Article checks\. Checks use saved content\./);
	assert.ok(html.includes('aria-label="SEO score ' + defaultShortDisplay.score + ' out of 100"'),
		"the opening score uses the default Article even with stored or session history");
	assert.doesNotMatch(html, /Choose a check profile|Choose which checks apply|General content checks\./, "profile selection is optional");
	assert.match(html, /id="[^"]*-focus-keyword"/);
	assert.match(html, /class="shipit-seo-native-preview-model"/);
	assert.equal((html.match(/aria-label="SEO checks"/g) ?? []).length, 1);
	assert.equal((html.match(/>Change check profile<\/button>/g) ?? []).length, 1, "the optional action opens the existing profile settings");
	assert.match(html, /<summary>Analysis options<\/summary>/);
	assert.doesNotMatch(html, /<details\b[^>]*class="[^"]*\bshipit-seo-analysis-options\b[^"]*"[^>]*\bopen=""/, "the profile disclosure is not opened as a render side effect");
}
for (const data of [
	{ custom_body: localSavedEntry.data.content },
	{ ...localSavedEntry.data, body_source: "template" },
]) {
	const unknownSnapshot = createSavedContentSnapshot("posts:action-owner", { ...localSavedEntry, data });
	const unknownPreview = { ...localPreview, sourceVersion: unknownSnapshot.sourceVersion, ownership: { ...localPreview.ownership!, sourceVersion: unknownSnapshot.sourceVersion } };
	const unknownAnalysis = resolveEditorBasicAnalysis({ ...shortProfileInput, snapshot: unknownSnapshot, sourceVersion: unknownSnapshot.sourceVersion,
		preview: unknownPreview, assessment: { state: "unconfigured", collection: "posts", revision: null } });
	if (unknownAnalysis.state !== "ready") throw new Error("Unknown body evidence keeps observed checks");
	assert.equal(seoScoreDisplay(unknownAnalysis.result).score, null, "a default profile cannot invent a complete body score");
	const html = renderHeader(null, { analysis: unknownAnalysis, onChooseCheckProfile: () => undefined });
	assert.match(html, /Some page content can(?:&#x27;|&#39;|’)t be checked, so a complete score/);
	assert.doesNotMatch(html, /to get a score|ring-progress|out of 100/, "choosing a profile is not presented as a repair for unsupported content");
}

// Exercise the actual saved-panel selection callback and focus helper against its one retained form.
const profileFocusEvents: string[] = [];
const profileFrames = new Map<number, () => void>();
let profileFrameId = 0;
let chosenProfileOpen = false;
let profileHidden = false;
let profileSelectDisabled = false;
const profileDetails = { open: false };
const profileSelectTarget = { focus: () => { profileFocusEvents.push("select"); } };
const profileSectionTarget = {
	isConnected: true,
	closest: (selector: string) => selector === "[hidden]" ? profileHidden ? {} : null : selector === "details" ? profileDetails : null,
	querySelector: (selector: string) => { assert.equal(selector, "select:not(:disabled)"); return profileSelectDisabled ? null : profileSelectTarget; },
	scrollIntoView: () => { profileFocusEvents.push("scroll"); },
	focus: () => { profileFocusEvents.push("section"); },
};
const profileFocusRef = { current: profileSectionTarget };
const profileFocusCancel: { current: (() => void) | null } = { current: null };
const profileFocusEffect = savedPanelDeclaration.body!.statements.find((statement) => ts.isExpressionStatement(statement) &&
	ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsedSource) === "React.useLayoutEffect" &&
	statement.getText(parsedSource).includes("assessmentFocusCancel"));
assert.ok(profileFocusEffect && ts.isExpressionStatement(profileFocusEffect) && ts.isCallExpression(profileFocusEffect.expression));
assert.equal(profileFocusEffect.expression.arguments[1].getText(parsedSource), "[ref, previewLocale]", "queued focus is canceled on entry and locale teardown");
const profileChoiceProduction = compileProduction([
	...["focusEditorCheckProfile", "afterPaint"].map((name) => productionDeclaration(name).getText(parsedSource)),
	"function ProfileChoiceProbe({ basicAnalysis, preview, assessmentOpen }) {",
	"const assessmentControlRef = profileFocusRef; const assessmentFocusCancel = profileFocusCancel; const setAssessmentDisclosureOpen = setProfileOpen;",
	savedVariable("chooseCheckProfile").getText(parsedSource),
	"return <BasicSlotsProbe basicAnalysis={basicAnalysis} preview={preview} assessmentOpen={assessmentOpen} chooseCheckProfile={chooseCheckProfile} onAssessmentToggle={setAssessmentDisclosureOpen} assessmentRef={assessmentControlRef} />;",
	"}",
	"module.exports = { ProfileChoiceProbe, focusEditorCheckProfile, cleanupFactory: " + profileFocusEffect.expression.arguments[0].getText(parsedSource) + " };",
].join("\n"), {
	React, BasicSlotsProbe: basicSlotProduction.BasicSlotsProbe, profileFocusRef, profileFocusCancel,
	assessmentFocusCancel: profileFocusCancel,
	setProfileOpen: (value: boolean) => { chosenProfileOpen = value; profileDetails.open = value; },
	window: {
		requestAnimationFrame: (run: () => void) => { const id = ++profileFrameId; profileFrames.set(id, run); return id; },
		cancelAnimationFrame: (id: number) => { profileFrames.delete(id); },
	},
}) as { ProfileChoiceProbe: React.ComponentType<Record<string, unknown>>; focusEditorCheckProfile: (section: unknown) => void; cleanupFactory: () => () => void };
const renderProfileChoice = (view: typeof workflowView = "analysis") => renderWorkflow(profileChoiceProduction.ProfileChoiceProbe,
	{ basicAnalysis: unconfiguredShort, preview: shortProfilePreview, assessmentOpen: chosenProfileOpen }, view);
function flushProfilePaint() {
	for (let paint = 0; paint < 2; paint += 1) {
		const work = [...profileFrames.values()]; profileFrames.clear();
		for (const run of work) run();
	}
}
const profileCallsBefore = JSON.stringify(workflowCalls);
renderProfileChoice("advanced");
const chooseProfileButton = workflowButtons.find((button) => button.children === "Change check profile");
assert.ok(chooseProfileButton && typeof chooseProfileButton.onClick === "function");
(chooseProfileButton.onClick as () => void)();
assert.equal(workflowView, "analysis", "the action reveals Analysis when invoked from Advanced");
assert.equal(chosenProfileOpen, true);
assert.deepEqual(profileFocusEvents, [], "opening schedules focus after the retained section becomes visible");
flushProfilePaint();
assert.deepEqual(profileFocusEvents, ["scroll", "select"], "the action scrolls to and focuses the existing profile select");
const openedProfileHtml = renderProfileChoice();
assert.equal((openedProfileHtml.match(/aria-label="Unsaved assessment selection"/g) ?? []).length, 1);
assert.match(openedProfileHtml, /<option value="general" selected="">General content<\/option>/, "opening does not alter the existing profile draft");
const openedAnalysisSection = workflowSections.find((section) => section["data-editor-view"] === "analysis")!;
const openedProfileNode = retainedProfileNode(openedAnalysisSection.children)!;
assert.equal(openedProfileNode.element.props.open, true);
const openedSettingsSection = (openedProfileNode.element.props.children as React.ReactElement<Record<string, unknown>>[])[1];
assert.equal(openedSettingsSection.props.ref, profileFocusRef, "the focus target belongs to that same one profile form");
(openedProfileNode.element.props.onToggle as (event: { currentTarget: { open: boolean } }) => void)({ currentTarget: { open: false } });
assert.equal(chosenProfileOpen, false, "the user can close Analysis options normally");
assert.doesNotMatch(renderProfileChoice(), /<details\b[^>]*class="[^"]*\bshipit-seo-analysis-options\b[^"]*"[^>]*\bopen=""/, "closing the profile disclosure does not close unrelated checklist groups");
assert.equal(JSON.stringify(workflowCalls), profileCallsBefore, "choosing a profile never saves, analyzes, refreshes metadata or activates a provider");
profileFocusEvents.length = 0;
const queuedButton = workflowButtons.find((button) => button.children === "Change check profile")!;
(queuedButton.onClick as () => void)();
profileChoiceProduction.cleanupFactory()();
flushProfilePaint();
assert.deepEqual(profileFocusEvents, [], "an entry or locale teardown cancels queued focus");
assert.equal(profileFocusCancel.current, null);
for (const unavailable of ["closed", "hidden", "detached"] as const) {
	profileDetails.open = unavailable !== "closed"; profileHidden = unavailable === "hidden"; profileSectionTarget.isConnected = unavailable !== "detached";
	profileChoiceProduction.focusEditorCheckProfile(profileSectionTarget);
	assert.deepEqual(profileFocusEvents, [], "no hidden or detached form is focused: " + unavailable);
}
profileDetails.open = true; profileHidden = false; profileSectionTarget.isConnected = true; profileSelectDisabled = true;
profileChoiceProduction.focusEditorCheckProfile(profileSectionTarget);
assert.deepEqual(profileFocusEvents, ["scroll", "section"], "a temporarily locked control focuses its labelled settings section instead");
profileFocusEvents.length = 0; profileSelectDisabled = false; profileDetails.open = false; chosenProfileOpen = false;

for (const view of ["analysis", "advanced"] as const) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: partialAnalysis, preview: partialPreview, localKeywordsPending: true }, view);
	assertWorkflow(html, true, view);
	assertSimpleScopeCopy(html);
	assert.match(html, /<strong>Partially checked<\/strong>/);
	assert.match(html, /Core SEO metadata is unavailable\. These checks cover observed saved body and keywords\./);
	assert.match(html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "", /<span>Unsaved keywords<\/span>/);
	assert.match(html, /id="[^"]*-focus-keyword"/, "known keywords remain editable without metadata");
	assert.doesNotMatch(html, /shipit-seo-native-panel__ring-progress|out of 100/);
	assert.match(html, /data-empty="true"/);
	const partialCoverage = keywordCheckCoverage(partialAnalysis.keywordOwnership.display[0], "primary", partialAnalysis.result);
	assert.ok(partialCoverage, "body rows still give the primary keyword its coverage with native SEO disabled");
	assert.ok(html.includes(`>${partialCoverage.count}</span>`));
	assert.ok(html.includes(partialCoverage.label));
	assert.doesNotMatch(html, /Preview text coverage|does not verify the live page or rankings/);
	assert.doesNotMatch(html, /Retry checks|Resolved preview could not be loaded/);
	if (view === "analysis") {
		assert.equal((html.match(/aria-label="SEO checks"/g) ?? []).length, 1);
		assert.doesNotMatch(html, /About these checks/);
		assert.match(html, /Saved analysis &amp; history/);
		assert.match(html, /Browser checks above are separate and are not saved to history/);
		const bodyCheck: SeoContentCheck = partialAnalysis.result.checks.find((check) => check.id === "content-depth")!;
		assert.ok(html.includes(bodyCheck.label));
		assert.equal(bodyCheck.basis, "measured");
		for (const check of partialAnalysis.result.checks.filter((check) => ["metadata", "links"].includes(check.category))) {
			assert.equal(check.basis, "unavailable");
			assert.ok(html.includes(check.detail), "partial presentation keeps masked metadata/link evidence");
		}
	}
}
function retainedProfileNode(node: unknown, path: string[] = []): { element: React.ReactElement<Record<string, unknown>>; path: string[] } | null {
	if (Array.isArray(node)) {
		for (const [index, child] of node.entries()) {
			const found = retainedProfileNode(child, [...path, "child:" + index]);
			if (found) return found;
		}
		return null;
	}
	if (!React.isValidElement<Record<string, unknown>>(node)) return null;
	const next = [...path, (typeof node.type === "string" ? node.type : "component") + ":" + (node.key ?? "")];
	if (node.key === "assessment:posts") return { element: node, path: next };
	return retainedProfileNode(node.props.children, next);
}
let retainedProfilePath: string[] | null = null;
for (const view of ["analysis", "advanced", "analysis"] as const) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: localAnalysis, preview: localPreview }, view);
	assertWorkflow(html, true, view);
	const analysisSection = workflowSections.find((section) => section["data-editor-view"] === "analysis")!;
	const profile = retainedProfileNode(analysisSection.children);
	assert.ok(profile, "the actual saved-panel slot retains its keyed settings form on both sections");
	assert.equal(profile.element.props.open, false);
	const settingsSection = (profile.element.props.children as React.ReactElement<{ children: unknown[] }>[])[1];
	assert.ok(settingsSection.props.children.includes(profileDraftControl), "the profile control is neither copied nor replaced on section changes");
	if (retainedProfilePath) assert.deepEqual(profile.path, retainedProfilePath, "the profile keeps its reconciliation position while Analysis is hidden");
	retainedProfilePath = profile.path;
	assert.match(html, /<option value="general" selected="">General content<\/option>/);
	const primaryOrder = ["shipit-seo-native-panel__summary", "data-probe-analyze-notice=", "Focus keywords", 'class="shipit-seo-native-preview-model"',
		'data-dialog-opener="social"', 'role="tablist"', 'aria-label="SEO checks"', "<summary>Analysis options</summary>",
		"<h4>Analysis settings</h4>", "<h4>Saved analysis &amp; history</h4>", "data-probe-analyze=", "Probe help for the explicit analysis.", "Open SEO workspace"].map((landmark) => html.indexOf(landmark));
	assert.ok(primaryOrder.every((position, index) => position >= 0 && (index === 0 || position > primaryOrder[index - 1])),
		"the score, keywords, preview and checklist precede optional saving inside Analysis options: " + JSON.stringify(primaryOrder));
	const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
	assert.doesNotMatch(header, /data-probe-analyze|summary-action|Save analysis/, "the real saved-panel header has no optional saved-analysis action");
	assert.equal((html.match(/data-probe-analyze="true"/g) ?? []).length, 1, "the options contain one deliberate saved-analysis action");
	assertSimpleScopeCopy(html);
	const afterChecks = html.slice(html.indexOf('aria-label="SEO checks"'));
	assert.equal((afterChecks.match(/<details class="shipit-seo-analysis-details/g) ?? []).length, 1, "only Analysis options follows the check groups");
}

const readySlotsHtml = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: localAnalysis, preview: localPreview });
assertWorkflow(readySlotsHtml, true, "analysis");
assert.match(readySlotsHtml, /Add more page text to get a score\./);
assert.match(readySlotsHtml, /shipit-seo-native-panel__keyword-chip-count/);
const noindexEntry = { ...localSavedEntry, seo: { ...localSavedEntry.seo, noIndex: true } };
const noindexSnapshot = createSavedContentSnapshot("posts:action-owner", noindexEntry);
const noindexPreview: SeoAdminEntryPreview = { ...localPreview, sourceVersion: noindexSnapshot.sourceVersion, entryNoindex: true, indexable: false,
	ownership: { ...localPreview.ownership!, sourceVersion: noindexSnapshot.sourceVersion, fields: localPreview.ownership!.fields.map((item) => item.field === "noIndex"
		? { ...item, core: true, effective: true } : item) },
};
const noindexAnalysis = resolveEditorBasicAnalysis({ preview: noindexPreview, snapshot: noindexSnapshot, ref: "posts:action-owner", sourceVersion: noindexSnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true, publicationStatus: "published" });
if (noindexAnalysis.state !== "ready") throw new Error("Expected measured noindex checks");
const noindexHtml = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: noindexAnalysis, preview: noindexPreview });
assertWorkflow(noindexHtml, true, "analysis");
assert.match(noindexHtml, /class="shipit-seo-native-panel__condition"[^>]*role="status"/);
assert.match(noindexHtml, /<strong>Excluded from search\.<\/strong>/);
assert.doesNotMatch(noindexHtml, /check-status">(?:Excluded from search|No noindex set)</, "the indexing directive is the banner only");
for (const analysis of [localAnalysis, partialAnalysis]) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: analysis, preview: partialPreview });
	assert.doesNotMatch(html, /class="shipit-seo-native-panel__condition"/, "partial or indexable checks cannot infer a noindex condition");
}
const customBodySnapshot = createSavedContentSnapshot("posts:action-owner", { ...localSavedEntry,
	data: { title: reviewSavedTitle, custom_body: localSavedEntry.data.content },
});
const customBodyPreview: SeoAdminEntryPreview = { ...localPreview, sourceVersion: customBodySnapshot.sourceVersion,
	ownership: { ...localPreview.ownership!, sourceVersion: customBodySnapshot.sourceVersion } };
const localCustomAnalysis = resolveEditorBasicAnalysis({ preview: customBodyPreview, snapshot: customBodySnapshot, ref: "posts:action-owner", sourceVersion: customBodySnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, keywords: ["dental implants"],
	assessment: { state: "configured", collection: "posts", revision: "custom-profile", profile: "article", version: 1 }, assessmentReady: true, publicationStatus: "draft" });
if (localCustomAnalysis.state !== "ready") throw new Error("Expected available local metadata checks");
assert.equal(localCustomAnalysis.result.checks.find((check) => check.id === "content-depth")?.basis, "unavailable");
const customDisplay = seoScoreDisplay(localCustomAnalysis.result);
assert.equal(customDisplay.label, "Partially checked");
assert.ok(customDisplay.qualifier);
const limitedBodyHtml = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: localCustomAnalysis, preview: customBodyPreview });
assert.match(limitedBodyHtml, /Some page content can(?:&#x27;|&#39;|’)t be checked, so a complete score isn(?:&#x27;|&#39;|’)t available\./);
assertSimpleScopeCopy(limitedBodyHtml);
assert.doesNotMatch(limitedBodyHtml.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "", /weighted checks? not checked|Weighted/,
	"one plain scope note explains unknown page content");
const serverCustomScore = { ...metadataOnlyScore, ...analyzeSeoContent({ ...actionInput,
	body: extractSeoDocumentText(contentBodyValue(customBodySnapshot.data, { portableTextBodyField: "custom_body" })),
	document: contentBodyValue(customBodySnapshot.data, { portableTextBodyField: "custom_body" }),
}), freshness: "current" as const, sourceVersion: customBodySnapshot.sourceVersion };
const serverDepth = serverCustomScore.checks.find((check) => check.id === "content-depth")!;
assert.equal(serverDepth.basis, "measured");
const browserDepth = localCustomAnalysis.result.checks.find((check) => check.id === "content-depth")!;
assert.notEqual(serverDepth.detail, browserDepth.detail);
const verifiedCustomSelection = selectEditorScore({ sessionScore: null, storedSnapshot: serverCustomScore, verifiedStoredScore: serverCustomScore, storedProfileChanged: false });
// One source: the verified result replaces the browser checks in the header, checklist and scope note.
for (const [name, selectedScore, keywordDirty, verified] of [
	["verified custom-body result", verifiedCustomSelection.score, false, true],
	["verified session result", { ...serverCustomScore, persistence: "session" as const }, false, true],
	["ordinary history", selectEditorScore({ sessionScore: null, storedSnapshot: serverCustomScore, storedProfileChanged: false }).score, false, false],
	["stale history", { ...serverCustomScore, freshness: "stale" as const }, false, false],
	["pending keyword draft", verifiedCustomSelection.score, true, false],
] as const) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: localCustomAnalysis, preview: customBodyPreview, score: selectedScore, keywordDirty });
	assertWorkflow(html, true, "analysis");
	const historyStart = html.indexOf("<h4>Saved analysis &amp; history</h4>");
	assert.ok(historyStart > 0, name);
	const mainHtml = html.slice(0, historyStart);
	const historyHtml = html.slice(historyStart);
	assert.equal((html.match(/aria-label="SEO checks"/g) ?? []).length, 1, name + " renders one checklist");
	assert.doesNotMatch(historyHtml, /aria-label="SEO checks"|class="shipit-seo-native-panel__check"|Weighted result|aria-label="[^"]*: /,
		name + " keeps history free of a second checklist or calculation");
	assert.doesNotMatch(scoreHeaderRegion(html), /<dl|Weighted checks|Weighted result|before limits|points<\/dd>/, name + " has no score mathematics");
	assert.equal(mainHtml.includes(escapeGroupText(serverDepth.detail)), verified, name + " checklist rows come from the shown source");
	assert.equal(mainHtml.includes(escapeGroupText(browserDepth.detail)), !verified, name);
	assert.equal(/Some page content can(?:&#x27;|&#39;|’)t be checked/.test(mainHtml), !verified, name);
	if (verified) {
		assert.ok(selectedScore, name);
		const display = seoScoreDisplay(serverCustomScore);
		assert.ok(mainHtml.includes(selectedScore.persistence === "session"
			? "Temporary check of saved content."
			: "Saved analysis of this entry."), name);
		assert.ok(mainHtml.includes(`<strong>${display.label}</strong>`), name + " header shows the verified band");
		if (display.score !== null) {
			assert.ok(mainHtml.includes(`role="img" aria-label="SEO score ${display.score} out of 100"`), name);
		}
		if (selectedScore.persistence !== "session") assert.match(historyHtml, /The checks above show this stored result\./);
	} else {
		assert.match(historyHtml, /Browser checks above are separate and are not saved to history/);
	}
}
const coverageKeywords = Object.freeze(["test", "xd", "asfasfas", "txse"]);
const coveragePreview: SeoAdminEntryPreview = { ...localPreview,
	content: { ...localPreview.content, slug: "test" }, search: { ...localPreview.search, title: "test xd", description: "test xd" },
};
const coverageAnalysis = resolveEditorBasicAnalysis({ preview: coveragePreview, snapshot: localSnapshot, ref: "posts:action-owner", sourceVersion: localSnapshot.sourceVersion,
	locale: "en", profile: null, profileReady: true, keywords: coverageKeywords,
	assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true, publicationStatus: "draft" });
if (coverageAnalysis.state === "unavailable") throw new Error(coverageAnalysis.reason);
const coverageHtml = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: coverageAnalysis, preview: coveragePreview });
assertWorkflow(coverageHtml, true, "analysis");
const coverageChips = coverageHtml.match(/<span[^>]*class="shipit-seo-native-panel__keyword-chip"[^>]*>/g) ?? [];
assert.equal(coverageChips.length, 4);
coverageKeywords.forEach((keyword, index) => {
	const coverage = keywordCheckCoverage(keyword, index === 0 ? "primary" : "secondary", { ...coverageAnalysis.result, keywords: coverageKeywords });
	assert.ok(coverage, keyword);
	assert.ok(coverageChips[index].includes(`data-tone="${coverage.tone}"`), keyword);
	assert.ok(coverageChips[index].includes(escapeGroupText(coverage.label)), keyword + " names its coverage from the checks");
});
assert.deepEqual(coverageKeywords.map((keyword, index) => keywordCheckCoverage(keyword, index === 0 ? "primary" : "secondary", { ...coverageAnalysis.result, keywords: coverageKeywords })?.tone),
	["review", "good", "poor", "poor"]);
assert.equal((coverageHtml.match(/class="shipit-seo-native-panel__keyword-chip-count"/g) ?? []).length, 1, "only the primary chip counts its keyword rows");
assert.deepEqual(coverageKeywords, ["test", "xd", "asfasfas", "txse"], "rendering preserves the saved keyword list and primary order");
assert.doesNotMatch(coverageHtml, /out of 100/);
for (const basicPreviewReady of [false, true]) {
	const html = renderWorkflow(basicSlotProduction.BasicSlotsProbe, { basicAnalysis: partialAnalysis, preview: partialPreview, basicPreviewReady });
	assertWorkflow(html, true, "analysis");
	assert.equal(html.includes("shipit-seo-native-panel__keyword-chip-count"), basicPreviewReady,
		"a cached or failed preview stays visible but cannot supply confirmed coverage");
	if (!basicPreviewReady) assert.doesNotMatch(html, /class="shipit-seo-native-panel__keyword-chip"[^>]*data-tone=/);
}
for (const field of ["title", "description"] as const) {
	const fieldUnknownPreview: SeoAdminEntryPreview = { ...localPreview, ownership: { ...localPreview.ownership!,
		fields: localPreview.ownership!.fields.map((item) => item.field === field ? { ...item, state: "unknown", reason: "legacy-read-incomplete" } : item),
	} };
	const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null, preview: fieldUnknownPreview });
	assertWorkflow(html, true, "analysis");
	assert.doesNotMatch(html, /shipit-seo-native-panel__keyword-chip-count|class="shipit-seo-native-panel__keyword-chip"[^>]*data-tone=/,
		field + ": without checks a chip claims no coverage");
}
// Published 1.3 hosts supply no draft/actions bridge. Render real read-only
// core fields while preserving the plugin-owned robots controls.
let advancedCanonicalSeed = "";
const advancedInputs: Array<Record<string, unknown>> = [];
const advancedSwitches: Array<Record<string, unknown>> = [];
const advancedWrites: unknown[] = [];
const advancedDirectiveWrites: unknown[] = [];
const advancedJsx = { ...workflowJsx,
	jsx: (type: unknown, props: Record<string, unknown>, key?: unknown) => {
		if (type === "input") advancedInputs.push(props);
		return workflowJsx.jsx(type, props, key);
	},
	jsxs: workflowJsx.jsxs,
};
const advancedProduction = compileProduction([
	"canonicalStatusLabel", "sourceLabel", "ROBOTS_DIRECTIVE_DEFAULTS", "ADVANCED_ROBOTS_OPTIONS", "AdvancedPanel",
].map((name) => productionDeclaration(name).getText(parsedSource)).join("\n") + "\nmodule.exports = { AdvancedPanel };", {
	React: { ...React, useState: (initial: unknown) => React.useState(initial === "" ? advancedCanonicalSeed : initial) },
	resolveSeoDraftIndexability, validateSeoCanonicalDraft, localeGraphDiagnosticLabel, ...previewIcons,
	INDEXING_WORKSPACE_URL: "/admin/plugins/shipit-seo/seo?view=indexing",
	Switch: (props: Record<string, unknown>) => {
		advancedSwitches.push(props);
		return React.createElement("button", { type: "button", role: "switch", disabled: Boolean(props.disabled), "aria-checked": Boolean(props.checked) }, String(props.label));
	},
}, (name) => name === "react/jsx-runtime" ? advancedJsx : requireMetadataRuntime(name)) as { AdvancedPanel: React.ComponentType<Record<string, unknown>> };
const advancedProps = { directives: { robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false } },
	directivesLoading: false, directivesLoadError: false, directivesSaving: false, directivesError: false,
	onDirectivesSave: (value: unknown) => advancedDirectiveWrites.push(value), onDirectivesRetry: () => undefined,
};
function renderAdvanced(props: Record<string, unknown>) {
	advancedInputs.length = 0;
	advancedSwitches.length = 0;
	return renderToStaticMarkup(React.createElement(advancedProduction.AdvancedPanel, { ...advancedProps, ...props }));
}
for (const preview of [localPreview, partialPreview]) {
	const html = renderAdvanced({ preview });
	assert.match(html, /Saved SEO fields, read-only/);
	assert.match(html, /Edit these fields in EmDash&#x27;s native SEO panel/);
	assert.match(html, /EmDash&#x27;s native SEO panel\. Its changes save separately and can affect the live page immediately/);
	assert.doesNotMatch(html, /type="(?:radio|url)"|id="shipit-seo-canonical-input"|shipit-seo-native-advanced__radio-card/);
	assert.equal(advancedInputs.length, 4);
	assert.ok(advancedInputs.every((input) => input.type === "checkbox" && !input.disabled));
	assert.equal(advancedSwitches[0].disabled, false, "the existing nofollow writer remains usable");
	assert.match(html, /Nofollow links|Advanced robots directives/);
	if (preview === partialPreview) {
		assert.match(html, /href="\/_emdash\/admin\/content-types\/posts"/);
		assert.match(html, /enable SEO in its definition/);
		assert.match(html, /<span>Entry indexing<\/span><strong title="Not confirmed">Not confirmed<\/strong>/);
	} else {
		assert.match(html, /<span>Entry indexing<\/span><strong title="Index allowed">Index allowed<\/strong>/);
		assert.doesNotMatch(html, /Open content type settings/);
	}
}
// The read-only row names the state the page gets, including an inherited rule, in the order the rules apply.
for (const [props, label] of [
	[{ siteNoindex: false }, "Index (site default)"],
	[{ siteNoindex: false, preview: { ...localPreview, indexable: false, noindexSources: ["content-type-rule"] } }, "Noindex from content type rule"],
	[{ siteNoindex: true, preview: { ...localPreview, indexable: false, noindexSources: ["site-setting", "content-type-rule"] } }, "Noindex from site-wide setting"],
] as const) {
	const html = renderAdvanced({ preview: localPreview, ...props });
	assert.match(html, new RegExp(`<span>Entry indexing</span><strong title="${label.replace(/[()]/g, "\\$&")}">`), label);
	assert.doesNotMatch(html, /<strong[^>]*>Index allowed<\/strong>/, label + " is not shown as allowed");
}
assert.deepEqual(advancedWrites, [] as unknown[]);
assert.deepEqual(advancedDirectiveWrites, [] as unknown[], "rendering read-only core values never saves directives");
const encodedTypeHtml = renderAdvanced({ preview: { ...partialPreview, content: { ...partialPreview.content, collection: "custom/type" } } });
assert.match(encodedTypeHtml, /href="\/_emdash\/admin\/content-types\/custom%2Ftype"/);
const noDraftHtml = renderAdvanced({ preview: localPreview, editorActions: { updateSeo: (value: unknown) => advancedWrites.push(value) } });
assert.match(noDraftHtml, /Saved SEO fields, read-only/, "actions without the host draft are not a writing bridge");
advancedCanonicalSeed = "https://example.invalid/new-canonical";
const capableHtml = renderAdvanced({ preview: localPreview,
	editorDraft: { data: {}, slug: localSavedEntry.slug, seo: { noIndex: false }, isDirty: false },
	editorActions: { updateSeo: (value: unknown) => advancedWrites.push(value) },
});
assert.doesNotMatch(capableHtml, /Saved SEO fields, read-only/);
assert.equal(advancedInputs.filter((input) => input.type === "radio").length, 2);
assert.ok(advancedInputs.every((input) => !input.disabled));
for (const input of advancedInputs.filter((input) => input.type === "radio")) (input.onChange as () => void)();
const capableCanonical = advancedInputs.find((input) => input.type === "url");
assert.ok(capableCanonical);
(capableCanonical.onBlur as () => void)();
assert.deepEqual(advancedWrites, [{ noIndex: false }, { noIndex: true }, { canonical: advancedCanonicalSeed }], "capable hosts keep the same native draft update handlers");
(advancedSwitches[0].onCheckedChange as () => void)();
(advancedInputs.find((input) => input.type === "checkbox")!.onChange as () => void)();
assert.deepEqual(advancedDirectiveWrites, [
	{ key: "nofollow", value: true },
	{ key: "noarchive", value: true },
]);
// The directive and schema switches write the user's new value on top of a read
// taken right before the write; the cached record can predate another admin's change.
const directiveMutationOptions = (owner: ts.FunctionDeclaration, name: string) => {
	const statement = owner.body!.statements.find((item) => ts.isVariableStatement(item) &&
		item.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name));
	assert.ok(statement && ts.isVariableStatement(statement), name);
	const call = statement.declarationList.declarations[0].initializer;
	assert.ok(call && ts.isCallExpression(call) && ts.isObjectLiteralExpression(call.arguments[0]), name);
	return call.arguments[0].getText(parsedSource);
};
const cachedDirectives = { storageVersion: 1, ref: "posts:entry-1", updatedAt: "2026-01-01T00:00:00.000Z",
	robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false }, disabledPresets: [] as string[] };
const storedDirectives = { ...cachedDirectives, updatedAt: "2026-01-01T00:04:00.000Z",
	robots: { ...cachedDirectives.robots, nosnippet: true }, disabledPresets: ["faq"] };
const directiveIo: string[] = [];
let directiveRead: unknown = { success: true, item: storedDirectives };
const directiveSwitches = compileProduction(productionDeclaration("ROBOTS_DIRECTIVE_DEFAULTS").getText(parsedSource) +
	"\nconst robots = " + directiveMutationOptions(savedPanelDeclaration, "directivesSave") +
	";\nconst presets = " + directiveMutationOptions(productionDeclaration("EntrySchemaManager") as ts.FunctionDeclaration, "presetToggle") +
	";\nmodule.exports = { robots, presets };", {
	ref: "posts:entry-1", SCORE_QUERY_SCOPE: "shipit-seo", directivesQuery: { data: cachedDirectives },
	queryClient: { invalidateQueries: async () => undefined }, savedReadback: { invalidate: () => undefined }, refreshSchemaState: () => undefined,
	fetchSeoEntryDirectives: async (...args: unknown[]) => { directiveIo.push("read " + JSON.stringify(args)); return directiveRead; },
	saveSeoEntryDirectives: async (...args: unknown[]) => {
		directiveIo.push("write " + JSON.stringify(args));
		return { success: true, item: null };
	},
}) as Record<"robots" | "presets", { mutationFn: (input: unknown) => Promise<unknown> }>;
await directiveSwitches.robots.mutationFn({ key: "noarchive", value: true });
await directiveSwitches.presets.mutationFn({ presetKey: "article", disabled: true });
await directiveSwitches.presets.mutationFn({ presetKey: "faq", disabled: false });
assert.deepEqual(directiveIo, [
	'read ["posts:entry-1"]',
	'write ["posts:entry-1",{"nofollow":false,"noarchive":true,"nosnippet":true,"noimageindex":false,"notranslate":false}]',
	'read ["posts:entry-1"]',
	'write ["posts:entry-1",null,{"disabledPresets":["faq","article"]}]',
	'read ["posts:entry-1"]',
	'write ["posts:entry-1",null,{"disabledPresets":[]}]',
], "each switch keeps the other admin's stored change and adds only its own");
directiveIo.length = 0;
directiveRead = { success: true, item: null };
await directiveSwitches.robots.mutationFn({ key: "nofollow", value: true });
assert.deepEqual(directiveIo.slice(1), [
	'write ["posts:entry-1",{"nofollow":true,"noarchive":false,"nosnippet":false,"noimageindex":false,"notranslate":false}]',
], "an entry without a stored record starts from the defaults, not from the cache");
directiveIo.length = 0;
directiveRead = { success: false, error: "storage_unavailable" };
await assert.rejects(directiveSwitches.robots.mutationFn({ key: "noarchive", value: false }), /Robots directives could not be saved/);
await assert.rejects(directiveSwitches.presets.mutationFn({ presetKey: "faq", disabled: true }), /The schema toggle could not be saved/);
assert.deepEqual(directiveIo, ['read ["posts:entry-1"]', 'read ["posts:entry-1"]'], "an unreadable record is never overwritten");
// Two headed groups by save scope; the entry draft group holds robots meta and canonical, the live group the directives.
const advancedGroupWrites: unknown[] = [];
const advancedCapableProps = { preview: localPreview,
	editorDraft: { data: {}, slug: localSavedEntry.slug, seo: { noIndex: false }, isDirty: false },
	editorActions: { updateSeo: (value: unknown) => advancedGroupWrites.push(value) } };
for (const props of [{ preview: localPreview }, advancedCapableProps]) {
	const html = renderAdvanced({ ...props, directivesSaving: true });
	const groups = [...html.matchAll(/<section class="shipit-seo-native-advanced__group" aria-labelledby="([^"]+)"><div class="shipit-seo-native-advanced__group-heading"><h4 id="([^"]+)">([^<]+)<\/h4><p>([^<]+)<\/p>/g)];
	assert.deepEqual(groups.map((match) => match[3]), ["Saved with the entry", "Applies to the live page now"]);
	for (const match of groups) assert.equal(match[1], match[2], "each group is named by its heading");
	assert.ok(groups.every((match) => match[4].length > 0), "each group has a one-line scope note");
	const liveStart = html.indexOf("Applies to the live page now");
	const entryGroup = html.slice(0, liveStart);
	const liveGroup = html.slice(liveStart, html.indexOf("shipit-seo-native-advanced__status"));
	assert.ok(liveGroup.includes("Saving robots directives..."), "directive progress shows only in the live group");
	assert.ok(!entryGroup.includes("Saving robots directives"));
	assert.match(liveGroup, /Nofollow links/);
	assert.match(liveGroup, /aria-label="Advanced robots directives"/);
	assert.match(liveGroup, /Robots directives apply to the live page as soon as they change; they are not part of the entry draft\./);
	if (props === advancedCapableProps) {
		assert.match(entryGroup, /<legend>Robots meta<\/legend>/);
		assert.match(entryGroup, /id="shipit-seo-canonical-input"/);
		assert.doesNotMatch(liveGroup, /type="radio"|shipit-seo-canonical-input/);
	} else {
		assert.match(entryGroup, /Saved SEO fields, read-only/);
	}
}
for (const [siteNoindex, label, note] of [[false, "Index (site default)", false], [null, "Index", false], [true, "Index", true]] as const) {
	const html = renderAdvanced({ ...advancedCapableProps, siteNoindex });
	assert.ok(html.includes(`<strong>${escapeMarkup(label)}</strong><small>Allow indexing for this entry</small>`), `site noindex ${siteNoindex}: ${label}`);
	assert.equal(html.includes('href="/admin/plugins/shipit-seo/seo?view=indexing"'), note, "only a site-wide noindex links to the Indexing rules");
	assert.equal(/Site-wide noindex is on/.test(html), note);
	const readOnly = renderAdvanced({ preview: localPreview, siteNoindex });
	assert.equal(/Site-wide noindex is on/.test(readOnly), note, "the site-wide note does not depend on the editor bridge");
}
// A content type rule is shown as inherited state, with its precedence and the missing opt-in.
const typeRulePreview = { ...localPreview, indexable: false, noindexSources: ["content-type-rule"] };
for (const props of [{ ...advancedCapableProps, preview: typeRulePreview }, { preview: typeRulePreview }]) {
	const html = renderAdvanced({ ...props, siteNoindex: false });
	assert.match(html, /data-scope="content-type"/);
	assert.doesNotMatch(html.slice(html.indexOf('data-scope="content-type"')).split("</p>")[0]!, /<li\b|role="alert"/, "the inherited rule is a note, not an error or a list item");
	assert.match(html, /Inherited: a content type rule adds noindex to every (?:<!-- -->)?[^<]+(?:<!-- -->)? entry, including this one\./);
	assert.match(html, /cannot opt back in, because its own setting can only add noindex\./);
	assert.match(html, /Order: site-wide noindex, then the content type rule, then this entry&#x27;s setting\./);
	assert.ok(html.includes('href="/admin/plugins/shipit-seo/seo?view=indexing"'), "the inherited state links to Indexing rules");
}
assert.ok(renderAdvanced({ ...advancedCapableProps, preview: typeRulePreview, siteNoindex: false })
	.includes("<strong>Index</strong><small>The content type rule still adds noindex</small>"), "Index is not offered as the site default under a rule");
assert.doesNotMatch(renderAdvanced({ ...advancedCapableProps, siteNoindex: false }), /content type rule/i, "control: no rule, no inherited note");
assert.doesNotMatch(renderAdvanced({ ...advancedCapableProps, preview: { ...localPreview, noindexSources: [] }, siteNoindex: false }), /content type rule/i);
assert.match(source, /const INDEXING_WORKSPACE_URL = `\$\{SEO_WORKSPACE_URL\}\$\{buildSeoAdminSearch\("", "indexing"\)\}`;/);
assert.match(source, /siteNoindex=\{siteSettings \? siteSettings\.noindex === true : null\}/, "an unread site setting is not reported as either state");
const advancedPanelSource = productionDeclaration("AdvancedPanel").getText(parsedSource);
assert.match(advancedPanelSource, / Applied to the editor draft\. Save the entry to persist\./);
assert.doesNotMatch(advancedPanelSource, /[\u2014\u2026]/, "the Advanced panel text has no em dash or ellipsis character");
assert.deepEqual(advancedGroupWrites, [], "rendering the grouped panel writes nothing");
const basicReadinessDeclaration = savedPanelDeclaration.body!.statements.find((statement) => ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "basicPreviewReady"));
const basicResultDeclaration = savedPanelDeclaration.body!.statements.find((statement) => ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "basicAnalysis"));
assert.ok(basicReadinessDeclaration && ts.isVariableStatement(basicReadinessDeclaration));
assert.ok(basicResultDeclaration && ts.isVariableStatement(basicResultDeclaration));
const basicResultCall = basicResultDeclaration.declarationList.declarations[0].initializer;
assert.ok(basicResultCall && ts.isCallExpression(basicResultCall));
const basicReadyProbe = compileProduction(`function basicProbe(previewQuery, preview = verifiedPreview) {
	${basicReadinessDeclaration.getText(parsedSource)}
	const compute = ${basicResultCall.arguments[0].getText(parsedSource)};
	return compute();
}
module.exports = { basicProbe };`, {
	resolveEditorBasicAnalysis, verifiedPreview: localPreview, savedSnapshot: localSnapshot, ref: "posts:action-owner", savedVersion: localSnapshot.sourceVersion,
	previewLocale: "en", profileQuery: { data: { profile: null } }, profileReady: true, keywordStatement: null,
	assessmentSelection: { state: "unconfigured", collection: "posts", revision: null }, assessmentReady: true,
	entry: { status: "draft" }, profileInitialized: { current: false }, pillarDraft: false,
}) as { basicProbe: (query: Record<string, boolean>, preview?: SeoAdminEntryPreview | null) => { state: string } };
const observedPreview = { isFetchedAfterMount: true, isSuccess: true, isFetching: false, isError: false };
assert.equal(basicReadyProbe.basicProbe(observedPreview).state, "ready", "opening a saved entry runs basic checks without selecting a profile");
assert.equal(basicReadyProbe.basicProbe(observedPreview, null).state, "unavailable", "mismatched ref/version preview cannot supply confirmed coverage");
for (const query of [
	{ ...observedPreview, isFetchedAfterMount: false },
	{ ...observedPreview, isFetching: true },
	{ ...observedPreview, isError: true },
	{ ...observedPreview, isSuccess: false },
]) assert.equal(basicReadyProbe.basicProbe(query).state, "unavailable", "cached metadata is not fresh evidence after a failed or unfinished read");
for (const [status, known] of [["loading", false], ["unavailable", false], ["unavailable", true]] as const) {
	const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps, score: null,
		keywordProfile: { status, known, onRetry: workflowCallbacks.settings },
	});
	assertWorkflow(html, true, "analysis");
	assert.equal(/id="[^"]*-focus-keyword"/.test(html), known, "unreadable defaults are not an editable keyword statement");
	if (known) assert.match(html, /<fieldset[^>]*disabled=""/);
	if (status === "unavailable") assert.match(html, /Retry keywords/);
}
for (const [previewLoading, previewError] of [[true, false], [false, true], [false, false]]) {
	const html = renderWorkflow(workflowProduction.SeoAnalysisDisclosure, { ...workflowProps,
		score: null, preview: null, previewLoading, previewError,
		unavailableContent: React.createElement(workflowProduction.UnavailableAnalysisProbe, { scoringEnabled: false, assessmentConfigured: false }),
	});
	assertWorkflow(html, false, "analysis");
	if (previewLoading) assert.match(html, /Loading resolved preview/);
	else if (previewError) {
		assert.match(html, /Resolved preview could not be loaded/);
		const retry = workflowButtons.find((button) => button.children === "Retry");
		assert.ok(retry && typeof retry.onClick === "function");
		(retry.onClick as () => void)();
	} else assert.match(html, /No resolved preview is available/);
}
// Loading a profile and persisting an intentional statement are independent
// from optional server analysis; both execute the production callbacks.
const profileInitEffect = savedPanelDeclaration.body!.statements.find((statement) =>
	ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
	statement.expression.expression.getText(parsedSource) === "React.useEffect" &&
	statement.getText(parsedSource).includes("if (!profileReady || !profileQuery.data || profileQuery.isError) return;"));
assert.ok(profileInitEffect && ts.isExpressionStatement(profileInitEffect) && ts.isCallExpression(profileInitEffect.expression));
const profileInitCallback = profileInitEffect.expression.arguments[0];
assert.ok(ts.isArrowFunction(profileInitCallback));
assert.doesNotMatch(profileInitCallback.getText(parsedSource), /scoringEnabled|analysisAdmitted|sessionAnalysis/);
const initializedProfile = { current: false };
const initializedValues: unknown[] = [];
const profileInit = compileProduction("const initialize = " + profileInitCallback.getText(parsedSource) + "; module.exports = { initialize };", {
	profileReady: true, profileQuery: { data: { profile: { keywords: ["stored keyword"], pillar: true } }, isError: false },
	profileInitialized: initializedProfile, keywordDraft: null, keywordBaseline: null, pillarDraft: false, pillarBaseline: false,
	keywordStatementsMatch: (left: unknown, right: unknown) => left === right,
	setKeywordDraft: (value: unknown) => initializedValues.push(value), setKeywordBaseline: (value: unknown) => initializedValues.push(value),
	setPillarDraft: (value: unknown) => initializedValues.push(value), setPillarBaseline: (value: unknown) => initializedValues.push(value),
}) as { initialize: () => void };
profileInit.initialize();
assert.equal(initializedProfile.current, true);
assert.deepEqual(initializedValues, [["stored keyword"], ["stored keyword"], true, true]);
const keywordMutation = savedPanelDeclaration.body!.statements.find((statement) => ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "keywordSave"));
assert.ok(keywordMutation && ts.isVariableStatement(keywordMutation));
const keywordCall = keywordMutation.declarationList.declarations[0].initializer;
assert.ok(keywordCall && ts.isCallExpression(keywordCall) && ts.isObjectLiteralExpression(keywordCall.arguments[0]));
const keywordMutationProperty = keywordCall.arguments[0].properties.find((property) =>
	ts.isPropertyAssignment(property) && property.name.getText(parsedSource) === "mutationFn");
assert.ok(keywordMutationProperty && ts.isPropertyAssignment(keywordMutationProperty));
const profileWrites: unknown[] = [];
const profileSave = compileProduction("const persist = " + keywordMutationProperty.initializer.getText(parsedSource) + "; module.exports = { persist };", {
	ref: "posts:action-owner", saveSeoFocusKeywords: async (...args: unknown[]) => {
		profileWrites.push(args); return { success: true, ref: "posts:action-owner", profile: null, item: null };
	},
}) as { persist: (input: { keywords: string[] | null; pillar: boolean }) => Promise<unknown> };
await profileSave.persist({ keywords: [], pillar: false });
await profileSave.persist({ keywords: null, pillar: true });
assert.deepEqual(profileWrites, [
	["posts:action-owner", [], { pillar: false, profileOnly: true }],
	["posts:action-owner", null, { pillar: true, profileOnly: true }],
]);
const keywordAutosaveSource = savedPanelSource.slice(savedPanelSource.indexOf("// Keyword-profile autosave:"), savedPanelSource.indexOf("const workspaceUrl ="));
assert.doesNotMatch(keywordAutosaveSource, /scoringEnabled|analysisAdmitted/);
assert.match(keywordAutosaveSource, /if \(!profileReady \|\| profileQuery\.isError\)/);

// Render the real action/profile declarations and exercise the real effect
// callbacks. Manual admission must never activate the session controller.

const manualStateSource = savedVariable("manualState").getText(parsedSource);
assert.doesNotMatch(manualStateSource, /scoringEnabled|analysisAdmitted|contentScoring|acknowledg/);
assert.match(savedVariable("analysisAdmitted").getText(parsedSource), /scoringEnabled && assessmentConfigured/,
	"the automatic session gate is unchanged");
const sessionEffects = savedPanelDeclaration.body!.statements.filter((statement) =>
	ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
	statement.expression.expression.getText(parsedSource) === "React.useEffect" &&
	statement.getText(parsedSource).includes("if (!analysisAdmitted"));
assert.equal(sessionEffects.length, 3, "cancel, cached resume and focus revalidation keep their existing gate");
const savedMutationCall = savedVariable("savedAnalysis").declarationList.declarations[0].initializer;
assert.ok(savedMutationCall && ts.isCallExpression(savedMutationCall) && ts.isObjectLiteralExpression(savedMutationCall.arguments[0]));
const savedMutationFn = savedMutationCall.arguments[0].properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(parsedSource) === "mutationFn");
assert.ok(savedMutationFn && ts.isPropertyAssignment(savedMutationFn));
const manualButtons: Array<Record<string, unknown>> = [];
function manualSaveButton() {
	const matches = manualButtons.filter((button) => button.children === "Save analysis" || button.children === "Saving analysis...");
	assert.equal(matches.length, 1, "one deliberate save action is available inside Analysis options");
	return matches[0]!;
}
const manualEffects: Array<() => void | (() => void)> = [];
const manualRequests: Array<unknown[]> = [];
const sessionWork = { cancel: 0, resume: 0, revalidate: 0, profile: 0, focus: 0 };
const keywordConfirmations: boolean[] = [];
const keywordWriteEpoch = { current: 0 };
const keywordWrites = { current: new Set<number>() };
let reloadSavedKeywords: () => Promise<{ isError: boolean; data?: unknown }> = async () => ({ isError: false, data: { profile: null } });
const manualProduction = compileProduction(`function ManualActionProbe({ policy, inputs = {}, result = null }) {
	const settingsReady = true;
	const settingsQuery = { isFetchedAfterMount: true, isSuccess: true, isFetching: false, isError: false, data: { values: {} }, ...inputs.settings };
	const scoringEnabled = policy === "enabled";
	const scoringPolicy = policy === "missing" ? undefined : { state: policy };
	const assessmentReady = inputs.assessmentReady ?? true;
	const assessmentConfigured = inputs.assessmentConfigured ?? true;
	const assessmentDirty = inputs.assessmentDirty ?? false;
	const assessmentSelection = { state: assessmentConfigured ? "configured" : "unconfigured", profile: "article" };
	const assessmentBoundary = JSON.stringify(assessmentSelection);
	const assessmentDisclosureOpen = false;
	const setAssessmentDisclosureOpen = () => {};
	const profileReady = inputs.profileReady ?? true;
	const profileQuery = { isError: !profileReady, data: { profile: { keywords: ["stored keyword"], pillar: false } }, refetch: () => reloadSavedKeywords() };
	const keywordDirty = inputs.keywordDirty ?? false;
	const keywordWriteUnconfirmed = inputs.keywordUnconfirmed ?? false;
	const keywordWritesPending = inputs.keywordWritesPending ?? keywordWrites.current.size;
	const keywordSave = { isPending: inputs.keywordSaving ?? false };
	const entry = { id: "entry-1", locale: "en" };
	const entryLocale = "en";
	const locale = inputs.locale ?? "en";
	const ref = "posts:entry-1";
	const collection = "posts";
	const savedVersion = "saved-v1";
	const savedAnalysisEpoch = "saved-request-epoch";
	const verifiedStoredScore = result;
	const assessmentControlRef = { current: null };
	const assessmentControl = <select aria-label="Assessment profile" defaultValue={assessmentConfigured ? "article" : ""}><option value="">Choose a profile</option><option value="article">Article</option></select>;
	const sendSavedRequest = ${savedMutationFn.initializer.getText(parsedSource)};
	const savedAnalysis = { isPending: inputs.pending ?? false, mutate: sendSavedRequest };
	const refresh = { isPending: false };
	${savedVariable("analysisAdmitted").getText(parsedSource)}
	${savedVariable("analysisTargetReady").getText(parsedSource)}
	${manualStateSource}
	${savedVariable("manualSavedAnalysisAdmitted").getText(parsedSource)}
	${savedVariable("analysisBlockedReason").getText(parsedSource)}
	const savedNoticeElement = null; const unavailableAnalysis = null; const storedHistory = () => null; const shownScore = null; const scoringUnknown = false;
	${savedVariable("analysisHelpId").getText(parsedSource)}
	${savedVariable("analysisHelp").getText(parsedSource)}
	${savedVariable("savedActionElement").getText(parsedSource)}
	${savedVariable("keywordReloadElement").getText(parsedSource)}
	${savedVariable("savedActionNotice").getText(parsedSource)}
	${savedVariable("analysisOptionsElement").getText(parsedSource)}
	${sessionEffects.map((statement) => "manualEffects.push(" + (statement as ts.ExpressionStatement & { expression: ts.CallExpression }).expression.arguments[0].getText(parsedSource) + ");").join("\n")}
	return <div data-session-admitted={analysisAdmitted}>{savedActionNotice}{analysisOptionsElement(null)}</div>;
}
module.exports = { ManualActionProbe };`, {
	React, editorManualAnalysisState, analysisPresentation, manualEffects, hasCurrentEditorAnalysis, SEO_WORKSPACE_URL: "/admin/plugins/shipit-seo/",
	Button: (props: Record<string, unknown>) => {
		manualButtons.push(props);
		return React.createElement("button", { type: "button", disabled: Boolean(props.disabled) }, props.children as React.ReactNode);
	},
	analyzeSavedSeoContent: async (...args: unknown[]) => { manualRequests.push(args); },
	keywordWriteEpoch, keywordWrites, reloadSavedKeywords: () => reloadSavedKeywords(), setKeywordWriteUnconfirmed: (value: boolean) => keywordConfirmations.push(value),
	savedReadback: { begin: () => 12, invalidate: () => undefined }, refreshRequest: { current: 0 },
	sessionAnalysis: {
		cancel: () => { sessionWork.cancel += 1; }, resume: () => { sessionWork.resume += 1; },
		revalidate: () => { sessionWork.revalidate += 1; }, hasAnalysisOptions: () => true,
		updateAnalysisOptions: () => { sessionWork.profile += 1; },
	},
	window: { addEventListener: () => { sessionWork.focus += 1; }, removeEventListener: () => undefined },
	document: { visibilityState: "visible", addEventListener: () => { sessionWork.focus += 1; }, removeEventListener: () => undefined },
}) as { ManualActionProbe: React.ComponentType<Record<string, unknown>> };
for (const policy of ["paused", "pending-confirmation"] as const) {
	manualButtons.length = 0; manualEffects.length = 0;
	const html = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy }));
	assert.match(html, /data-session-admitted="false"/);
	assert.match(html, /<summary>Analysis options<\/summary><section class="shipit-seo-analysis-options__section" tabindex="-1" aria-label="Analysis settings"><h4>Analysis settings<\/h4><select/);
	assert.doesNotMatch(html, /<details[^>]*\bopen=|enable analysis|Review resource use/);
	assert.equal(manualButtons.length, 1);
	assert.equal(manualSaveButton().disabled, false, policy + " permits one deliberate manual action");
	assert.deepEqual([manualSaveButton().children, manualSaveButton().variant, manualSaveButton().size, manualSaveButton().title],
		["Save analysis", "secondary", "sm", "Save a result for the saved content and keywords. Unsaved page edits are not included."],
		"the optional Save analysis button keeps its saved-version explanation");
	const helpId = manualSaveButton()["aria-describedby"] as string;
	assert.ok(helpId, "the help or disabled reason is the button's description, not only a hover tooltip");
	assert.ok(html.includes(`<span id="${helpId}" hidden="">Save a result for the saved content and keywords. Unsaved page edits are not included.</span>`));
	assert.match(html, /<h4>Saved analysis &amp; history<\/h4>[\s\S]*?<button[^>]*>Save analysis<\/button>[\s\S]*?<p class="shipit-seo-muted">Save a result for the saved content and keywords\. Unsaved page edits are not included\.<\/p>/);
	assert.equal((html.match(/>Save analysis<\/button>/g) ?? []).length, 1, "one save action is rendered only inside options");
	const before = manualRequests.length;
	for (const effect of manualEffects) effect();
	assert.equal(manualRequests.length, before, "mount/read effects never analyze");
	assert.deepEqual({ ...sessionWork, cancel: 0 }, { cancel: 0, resume: 0, revalidate: 0, profile: 0, focus: 0 });
	(manualSaveButton().onClick as () => void)();
	assert.deepEqual(manualRequests.at(-1), ["posts:entry-1", "en"]);
	assert.equal(manualRequests.length, before + 1, "one click sends one exact saved-entry command");
}
for (const [inputs, expected] of [
	[{ assessmentConfigured: false }, /Choose and save/],
	[{ assessmentReady: false }, /Load the assessment profile/],
	[{ assessmentDirty: true }, /Save or reset/],
	[{ profileReady: false }, /Load the saved focus keywords/],
	[{ keywordDirty: true }, /keyword changes to save/],
	[{ keywordSaving: true }, /keyword changes to save/],
	[{ keywordUnconfirmed: true }, /Reload saved focus keywords/],
	[{ locale: "nl" }, /current language/],
	[{ settings: { isFetching: true } }, /saved SEO settings/],
	[{ settings: { isError: true } }, /saved SEO settings/],
] as const) {
	manualButtons.length = 0; manualEffects.length = 0;
	const html = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy: "paused", inputs }));
	assert.equal(manualSaveButton().disabled, true);
	assert.match(html, expected);
	assert.match(String(manualSaveButton().title), expected, "the disabled button names its reason");
	const described = html.slice(html.indexOf(`<span id="${String(manualSaveButton()["aria-describedby"])}" hidden="">`));
	const reason = described.slice(0, described.indexOf("</span>"));
	assert.match(reason, expected, "the disabled reason is also the button's description");
	const before = manualRequests.length;
	(manualSaveButton().onClick as () => void)();
	for (const effect of manualEffects) effect();
	assert.equal(manualRequests.length, before, "unready profiles and keyword changes never start server analysis");
	if ("assessmentConfigured" in inputs) assert.doesNotMatch(html, /<details[^>]*\bopen=""/, "a required profile is still configured through a deliberate disclosure");
}
for (const policy of ["unavailable", "missing"]) {
	manualButtons.length = 0; manualEffects.length = 0;
	const html = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy }));
	assert.equal(manualSaveButton().disabled, true, "readable values alone do not admit an unreadable automatic policy");
	assert.match(html, /saved SEO settings/);
	const before = manualRequests.length;
	(manualSaveButton().onClick as () => void)();
	for (const effect of manualEffects) effect();
	assert.equal(manualRequests.length, before);
}
manualButtons.length = 0; manualEffects.length = 0;
const qualifiedManualScore = verifiedSelection.score!;
const qualifiedManualPresentation = analysisPresentation(qualifiedManualScore);
assert.ok(qualifiedManualPresentation.qualifier, "the metadata-only control is a limited assessment");
const confirmedManual = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, {
	policy: "paused", result: qualifiedManualScore,
}));
assert.doesNotMatch(confirmedManual, /Stored result matches this version/, "the manual action area does not repeat the sidebar scope");
assert.doesNotMatch(confirmedManual, /\/100|out of 100|Verified saved analysis/);
manualButtons.length = 0;
renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy: "paused", inputs: { pending: true } }));
assert.deepEqual([manualSaveButton().children, manualSaveButton().disabled], ["Saving analysis...", true], "a pending save shows its pending text and cannot repeat");
assert.doesNotMatch(confirmedManual, /history was recorded|history was updated/);

const completeManualProse = "Appointment preparation begins with a short list of practical questions for your care team. Bring relevant information about medicines, allergies and previous treatment to help explain your circumstances. Confirm your appointment time and ask how long the visit may take. Write down the advice you receive so you can review it later. Contact the practice if any instruction is unclear or your needs change.";
const completeManualAnalysis = analyzeSeoContent({ ...actionInput,
		title: "Growth marketing strategy for measurable demand",
		description: "A practical growth marketing strategy that connects search, content, paid media and measurement to build qualified demand and sustainable growth.",
		body: completeManualProse, document: [
			{ _type: "block", style: "normal", children: [{ _type: "span", text: completeManualProse }] },
		],
		focusKeyword: undefined, focusKeywords: [], assessmentProfile: { profile: "general", version: 1 },
		image: "https://example.invalid/social.jpg", schemaEnabled: true, schemaPreset: "Article",
	});
const completeManualScore = { ...completeManualAnalysis, freshness: "current" as const } as Parameters<typeof analysisPresentation>[0];
assert.equal(seoAnalysisSummary(completeManualScore).numericBadgeAvailable, true, "the numerical control has fully observed checks");
assert.equal(analysisPresentation(completeManualScore).qualifier, "No focus keyword", "an unset keyword qualifies the number without hiding it");
for (const [name, renderComplete] of [
	["saved", () => renderHeader(completeManualScore)],
	["browser", () => renderHeader(null, { analysis: { ...localAnalysis, result: completeManualAnalysis } })],
] as const) {
	const before = JSON.stringify(completeManualScore);
	const html = renderComplete();
	assertSimpleScopeCopy(html);
	const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
	assert.ok(header.includes(`role="img" aria-label="SEO score ${completeManualScore.score} out of 100"`), name + " names the ring with its number");
	assert.ok(header.includes(`<span aria-hidden="true">${completeManualScore.score}</span>`), name + " retains a fully qualified numerical score");
	assert.match(header, /class="shipit-seo-native-panel__ring-progress"/);
	assert.ok(header.includes(`<strong>${seoScoreDisplay(completeManualScore).label}</strong>`), name + " shows the band of the limited score");
	assert.match(header, /<span>No focus keyword<\/span>/, name + " carries the No focus keyword qualifier");
	const totals = contentCheckPresentation(completeManualScore).totals;
	assert.ok(header.includes(`<span>${seoCheckTotalsText(totals)}</span>`), name + " counts are the group sums");
	assert.doesNotMatch(header, /scored checks|weighted|Weighted|General|Article|aria-live/);
	assert.doesNotMatch(html, /before limits|Weighted|points<\/dd>|<dl/, name + " keeps score mathematics out of the sidebar");
	assert.ok(html.includes(name === "browser" ? "Checks use saved content." : "Saved analysis of this entry."), name + " states the result scope");
	assert.equal(JSON.stringify(completeManualScore), before, name + " presentation never changes assessment arithmetic");
}
// The existing limit remains in the score; the sidebar does not expose its raw calculation.
const limitedScore = { ...analyzeSeoContent({ ...actionInput, image: "https://example.invalid/social.jpg" }), freshness: "current" as const } as Parameters<typeof analysisPresentation>[0];
const limitedDisplay = seoScoreDisplay(limitedScore);
assert.equal(limitedDisplay.limit?.cap, 40);
assert.ok(limitedScore.calculation && limitedScore.calculation.rawScore > 40);
const limitedHtml = renderHeader(limitedScore);
const limitedHeader = limitedHtml.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
assert.ok(limitedHeader.includes(`<span>${seoScoreLimitText(limitedDisplay.limit!)}</span>`), "the limit is named beside the counts");
assert.ok(limitedHeader.includes(`aria-label="SEO score ${limitedScore.score} out of 100"`));
assert.doesNotMatch(limitedHtml, /before limits|<dt>Limits|Weighted|points<\/dd>|<dl/);
const localKeywordHeader = renderHeader(null, { analysis: localAnalysis, keywordsPending: true });
assert.match(localKeywordHeader, /<span>Unsaved keywords<\/span>/);
assert.match(localKeywordHeader, /Using your keyword changes\./);
const savedKeywordHeader = renderHeader(verifiedSelection.score, { keywordsPending: true });
assert.match(savedKeywordHeader, /<span>Unsaved keywords<\/span>/);
assert.match(savedKeywordHeader, /This saved result does not include your keyword changes\./);
assert.doesNotMatch(savedKeywordHeader, /Using your keyword changes\./, "a retained saved result never claims to include unsaved keyword edits");

const completeManualBefore = JSON.stringify(completeManualScore);
const completeManual = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, {
	policy: "paused", result: completeManualScore,
}));
assert.doesNotMatch(completeManual, /Stored result matches this version/);
assert.doesNotMatch(completeManual, /\/100/, "the action area adds no third number");
assert.equal(JSON.stringify(completeManualScore), completeManualBefore);
const pendingKeywordProof = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, {
	policy: "paused", result: verifiedSelection.score, inputs: { keywordDirty: true },
}));
assert.doesNotMatch(pendingKeywordProof, /Stored result matches this version/, "unsaved keyword changes cannot keep a current stored claim");

// A failed write cannot become confirmed just because the local draft was reset.
// Only the explicit read's matching generation may clear that prerequisite.
for (const state of ["success", "failed", "newer-write", "outstanding-after-read"] as const) {
	manualButtons.length = 0; manualEffects.length = 0; keywordConfirmations.length = 0;
	let finishRead!: (value: { isError: boolean; data?: unknown }) => void;
	reloadSavedKeywords = () => new Promise((resolve) => { finishRead = resolve; });
	const recoveryHtml = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy: "paused", inputs: { keywordUnconfirmed: true } }));
	assert.ok(recoveryHtml.indexOf("Reload saved keywords") < recoveryHtml.indexOf("<summary>Analysis options</summary>"), "uncertain keyword recovery remains visible outside closed options");
	const reload = manualButtons.find((button) => button.children === "Reload saved keywords")!;
	assert.ok(reload && typeof reload.onClick === "function");
	(reload.onClick as () => void)();
	if (state === "newer-write") keywordWriteEpoch.current += 1;
	if (state === "outstanding-after-read") keywordWrites.current.add(999);
	finishRead({ isError: state === "failed", data: state === "failed" ? undefined : { profile: null } });
	await Promise.resolve();
	assert.deepEqual(keywordConfirmations, state === "success" ? [false] : [], state);
	keywordWrites.current.delete(999);
}

// An actual observer reset detaches its pending result but leaves the write
// running. The production hook callbacks must retain that outstanding token.
const raceQueryClient = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
let raceOutstandingCount = 0;
let raceUnconfirmed = false;
let raceBaseline = false;
let raceReads = 0;
let markWriteStarted!: () => void;
let finishWrite!: (value: unknown) => void;
const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
const deferredWrite = new Promise((resolve) => { finishWrite = resolve; });
const racePillarDraft = { current: false };
const raceMutation = compileProduction("const options = " + keywordCall.arguments[0].getText(parsedSource) + "; module.exports = { options };", {
	ref: "posts:entry-1", profileKey: ["shipit-seo", "profile", "posts:entry-1"], queryClient: raceQueryClient,
	keywordWrites, keywordWriteEpoch,
	setKeywordWritesPending: (count: number) => { raceOutstandingCount = count; },
	setKeywordWriteUnconfirmed: (value: boolean) => { raceUnconfirmed = value; },
	savedReadback: { invalidate: () => undefined },
	saveSeoFocusKeywords: async () => { markWriteStarted(); return deferredWrite; },
	refreshRequest: { current: 0 }, keywordDraftRef: { current: null }, pillarDraftRef: racePillarDraft,
	keywordStatementsMatch: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
	setKeywordBaseline: () => undefined, setPillarBaseline: (value: boolean) => { raceBaseline = value; },
	setKeywordDraft: () => undefined, setPillarDraft: (value: boolean) => { racePillarDraft.current = value; },
	setKeywordSavedFlash: () => undefined, keywordSavedFlashTimer: { current: null }, setTimeout: () => 0, clearTimeout: () => undefined,
}) as { options: ConstructorParameters<typeof MutationObserver>[1] };
const raceObserver = new MutationObserver(raceQueryClient, { ...raceMutation.options, gcTime: 0 });
const unsubscribeRace = raceObserver.subscribe(() => undefined);
manualButtons.length = 0; manualEffects.length = 0;
renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy: "paused" }));
const previouslyReadyManual = manualSaveButton().onClick as () => void;
assert.equal(manualSaveButton().disabled, false);
const raceCompletion = raceObserver.mutate({ keywords: null, pillar: true });
await writeStarted;
assert.equal(raceObserver.getCurrentResult().isPending, true);
assert.equal(keywordWrites.current.size, 1);
racePillarDraft.current = false;
raceObserver.reset();
assert.equal(raceObserver.getCurrentResult().isIdle, true, "reset reproduces an idle observer around a live network write");
assert.equal(raceOutstandingCount, 1);
assert.equal(raceUnconfirmed, true);
reloadSavedKeywords = async () => { raceReads += 1; return { isError: false, data: { profile: { keywords: null, pillar: false } } }; };
manualButtons.length = 0; manualEffects.length = 0;
const raceHtml = renderToStaticMarkup(React.createElement(manualProduction.ManualActionProbe, { policy: "paused", inputs: {
	keywordUnconfirmed: raceUnconfirmed, keywordWritesPending: raceOutstandingCount, keywordSaving: raceObserver.getCurrentResult().isPending,
} }));
assert.match(raceHtml, /keyword changes to save/);
const raceReload = manualButtons.find((button) => button.children === "Reload saved keywords")!;
assert.equal(manualSaveButton().disabled, true);
assert.equal(raceReload.disabled, true);
const beforeRace = manualRequests.length;
previouslyReadyManual();
(manualSaveButton().onClick as () => void)();
(raceReload.onClick as () => void)();
await Promise.resolve();
assert.equal(raceReads, 0, "reload cannot read the pre-commit baseline after observer reset");
assert.equal(manualRequests.length, beforeRace, "both current and previously ready manual handlers respect the live write token");
assert.equal(raceUnconfirmed, true);
finishWrite({ success: true, profile: { keywords: null, pillar: true }, item: null });
await raceCompletion;
assert.equal(keywordWrites.current.size, 0, "hook-level settled cleanup runs even after observer reset");
assert.equal(raceOutstandingCount, 0);
assert.equal(raceUnconfirmed, false, "the matching save acknowledgement confirms the persisted baseline");
assert.equal(raceBaseline, true);
assert.equal(racePillarDraft.current, false, "the newer deliberate draft is preserved");
assert.equal(editorManualAnalysisState({ settingsReady: true, assessmentReady: true, assessmentConfigured: true,
	assessmentDirty: false, profileReady: true, keywordDirty: raceBaseline !== racePillarDraft.current,
	keywordSaving: raceOutstandingCount > 0, savedTargetReady: true }).admitted, false);
unsubscribeRace();
raceQueryClient.clear();
// A failed profile write may already be stored, so one change sends exactly one
// request even when the client default would retry it.
const uncertainQueryClient = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0, gcTime: 0 } } });
for (const [label, respond] of [
	["transport failure", () => { throw new TypeError("Failed to fetch"); }],
	["HTTP 5xx", () => { throw new Error("Failed to save the focus keywords"); }],
	["storage failure", () => ({ success: false, error: "storage_unavailable" })],
] as const) {
	let saveRequests = 0;
	const uncertainWrites = { current: new Set<number>() };
	const uncertainMutation = compileProduction("const options = " + keywordCall.arguments[0].getText(parsedSource) + "; module.exports = { options };", {
		...keywordProfileModule,
		ref: "posts:entry-1", profileKey: ["shipit-seo", "profile", "posts:entry-1"], queryClient: uncertainQueryClient,
		keywordWrites: uncertainWrites, keywordWriteEpoch: { current: 0 },
		setKeywordWritesPending: () => undefined, setKeywordWriteUnconfirmed: () => undefined,
		savedReadback: { invalidate: () => undefined },
		focusKeywordErrorMessage: () => "The keyword profile could not be saved.",
		saveSeoFocusKeywords: async () => { saveRequests += 1; return respond(); },
	}) as { options: ConstructorParameters<typeof MutationObserver>[1] };
	const uncertainObserver = new MutationObserver(uncertainQueryClient, uncertainMutation.options);
	const unsubscribeUncertain = uncertainObserver.subscribe(() => undefined);
	let retryWindow: ReturnType<typeof setTimeout> | undefined;
	const settled = await Promise.race([
		uncertainObserver.mutate({ keywords: ["uncertain keyword"], pillar: false }).then(() => "saved", () => "failed"),
		new Promise((resolve) => { retryWindow = setTimeout(resolve, 8_000, "still retrying"); }),
	]);
	clearTimeout(retryWindow);
	assert.equal(saveRequests, 1, label + ": the keyword save is sent exactly once");
	assert.equal(settled, "failed", label);
	assert.equal(uncertainObserver.getCurrentResult().isError, true, label + ": the failure waits for the manual Retry");
	assert.equal(uncertainWrites.current.size, 0, label);
	unsubscribeUncertain();
}
uncertainQueryClient.clear();
const invalidateEffect = savedPanelDeclaration.body!.statements.find((statement) =>
	ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
	statement.expression.expression.getText(parsedSource) === "React.useEffect" &&
	statement.getText(parsedSource).includes("if (analysisAdmitted) return;"));
assert.ok(invalidateEffect && ts.isExpressionStatement(invalidateEffect) && ts.isCallExpression(invalidateEffect.expression));
const proofEvents: Array<() => void> = [];
let expiredProofs = 0;
const expireProof = compileProduction("const listen = " + invalidateEffect.expression.arguments[0].getText(parsedSource) + "; module.exports = { listen };", {
	analysisAdmitted: false, savedReadback: { invalidate: () => { expiredProofs += 1; } },
	window: { addEventListener: (_name: string, listener: () => void) => proofEvents.push(listener), removeEventListener: () => undefined },
	document: { addEventListener: (_name: string, listener: () => void) => proofEvents.push(listener), removeEventListener: () => undefined },
}) as { listen: () => () => void };
const beforeReturn = manualRequests.length;
const cleanupProof = expireProof.listen();
assert.equal(expiredProofs, 0, "mounting expires no proof and makes no request");
proofEvents.forEach((listener) => listener());
cleanupProof();
assert.equal(expiredProofs, 2);
assert.equal(manualRequests.length, beforeReturn, "focus and visibility only withdraw manual proof");
assert.deepEqual({ ...sessionWork, cancel: 0 }, { cancel: 0, resume: 0, revalidate: 0, profile: 0, focus: 0 });
assert.match(activationSource, /Automatic &amp; bulk analysis/);
assert.match(contentHealthSource, /Scans currently require automatic analysis to be enabled/);
assert.deepEqual(workflowCalls, { analyze: 0, social: 0, preview: 1, score: 0, directives: 0, settings: 0 },
	"rendering every workflow state runs no analysis, Social save or automatic retry");

// Round 2 editor behaviour.
{
	// The sidebar shows only the phone fit; the dialog keeps both devices.
	assert.match(source, /const snippet = <SearchSnippetFrame preview=\{preview\} device="mobile"/);
	assert.match(source, /className="shipit-seo-native-preview"\s*data-device="mobile"/);
	assert.equal((source.match(/<SearchSnippetFrame[^>]*device=\{device\}/g) ?? []).length, 2, "both dialog cards follow the device toggle");
	// Dialog focus order: tabs, then the device and result page tools, then the panel; the tablist is named.
	const header = source.slice(source.indexOf('<div className="shipit-seo-snippet-dialog__header">'), source.indexOf("<Dialog.Description"));
	assert.ok(header.indexOf("<Tabs") > 0 && header.indexOf("<Tabs") < header.indexOf('className="shipit-seo-snippet-dialog__view-tools"'),
		"the header tools follow the tabs in focus order");
	assert.match(source, /const nameDialogTabs = React\.useCallback\(\(node: HTMLDivElement \| null\) => \{\n\t\tdialogTabsRef\.current = node;\n\t\tnode\?\.querySelector\('\[role="tablist"\]'\)\?\.setAttribute\("aria-label", "Edit SEO sections"\);\n\t\}, \[\]\);/,
		"the tablist is named whenever the dialog content mounts, not after a render of the panel");
	assert.match(source, /<div ref=\{nameDialogTabs\} className="shipit-seo-snippet-dialog__tabs">/);
	assert.match(cssRule(css, ".shipit-seo-snippet-dialog__header"), /grid-template-areas:/);
	// The save scope names its effect from the saved entry's status.
	assert.match(source, /<NativeSeoSaveStatus controller=\{nativeEditor\} publicationStatus=\{savedEntry\?\.status \?\? null\} \/>/);
	assert.match(source, /<NativeSeoTextFields controller=\{nativeEditor\} preview=\{preview\} legacyGuidance=\{legacyRecordGuidance\(brand\.name\)\}\s*datePrefix=\{seoSnippetDatePrefix\(preview\.search\.publishedAt, locale\)\} \/>/,
		"the field estimate measures the date the preview shows");
	assert.match(source, /nativeEditor\.restoredDraft && !editing \? \(\s*<p className="shipit-seo-native-preview__pending" role="status">/,
		"a kept draft is named in the sidebar when returning to the entry");
	// A stored result for this saved version and keywords is confirmed after a reload with one read.
	assert.match(savedPanelSource, /const storedCandidate = !verifiedStoredScore && storedSnapshot && storedSnapshot\.freshness !== "stale"/);
	assert.match(savedPanelSource, /storedSnapshot\.sourceVersion === savedVersion && profileReady && !storedProfileChanged \? storedSnapshot : null;/);
	assert.match(savedPanelSource, /void savedReadback\.confirmStored\(storedCandidate, \{ ref, locale: entryLocale, savedVersion \}, savedReadback\.begin\(\)\);/);
	assert.match(savedPanelSource, /if \(!storedCheckKey \|\| !storedCandidate \|\| storedCheckRequested\.current === storedCheckKey \|\| savedAnalysis\.isPending\) return;/,
		"one check per saved version, keywords and return to the tab; never while Analyze runs");
	// Refreshing inputs keep the last browser checks, marked as updating, instead of a dash.
	assert.match(savedPanelSource, /basicAnalysis=\{shownBasic \?\? undefined\}\s*analysisUpdating=\{retainedBasic !== null\}/);
	assert.match(savedPanelSource, /const retainedBasic = basicAnalysis\.state === "unavailable" && basicInputsRefreshing && basicRetention\.current\?\.key === basicRetentionKey/);
	const updatingHeader = renderToStaticMarkup(React.createElement(headerProduction.AnalysisHeader, {
		source: headerProduction.editorAnalysisSource(null, { ...localAnalysis, result: completeManualAnalysis }), score: null, keywordsPending: false, updating: true,
	}));
	assert.match(updatingHeader, /<span>Updating checks\.\.\.<\/span>/);
	assert.match(updatingHeader, /aria-label="SEO score \d+ out of 100"/, "the last number stays visible while it updates");
	assert.doesNotMatch(updatingHeader, /<strong>Not checked<\/strong>/);
	// Contrast and size: existing tokens, at least 11 px.
	assert.match(cssRule(css, ".shipit-seo-native-panel__live"), /color: var\(--text-color-kumo-subtle, #667085\);/);
	assert.match(cssRule(css, ".shipit-seo-snippet-dialog__device"), /background: var\(--color-kumo-tint, #eef1f5\);/);
	assert.match(css, /:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-native-panel__check > button \{\s*color: var\(--text-color-kumo-link, #84caff\);/);
	assert.match(css, /:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-native-advanced__row strong\[data-positive="true"\],[\s\S]*?color: var\(--shipit-seo-pill-good-color, #75e0a7\);/);
	assert.match(cssRule(css, ".shipit-seo-native-advanced__row strong"), /font-size: 11px;/);
	assert.match(css, /\.shipit-seo-native-advanced__row span,\n\.shipit-seo-native-advanced__schemas > span,\n\.shipit-seo-native-advanced__schemas p \{\n\tcolor: var\(--text-color-kumo-subtle, #667085\);\n\tfont-size: 11px;/,
		"Advanced field labels are at least 11 px");
	for (const selector of [".shipit-seo-native-advanced__locale-heading > div > span", ".shipit-seo-native-advanced__locale-heading > span", ".shipit-seo-native-advanced__locale-issues li"])
		assert.match(cssRule(css, selector), /font-size: 11px;/, selector);
}

// Tab and Shift+Tab wrap inside the open Edit SEO dialog, so focus never lands on its empty guards.
{
	const workflow = productionDeclaration("SearchPreview").getText(parsedSource);
	const wrap = workflow.slice(workflow.indexOf("const wrapTab = (event: KeyboardEvent) => {"), workflow.indexOf("const handleEditorOpenChange"));
	assert.ok(wrap.length > 0);
	assert.match(workflow, /React\.useEffect\(\(\) => \{\n\t\tif \(!editing\) return;\n\t\tconst wrapTab = \(event: KeyboardEvent\) => \{/, "only an open dialog wraps focus");
	assert.match(wrap, /if \(!dialog \|\| !\(event\.target instanceof Node\) \|\| !dialog\.contains\(event\.target\)\) return;/, "a nested picker dialog keeps its own order");
	assert.match(wrap, /!element\.hasAttribute\("data-base-ui-focus-guard"\)/);
	assert.match(wrap, /const target = dialogTabWrapTarget\(tabbables, document\.activeElement, event\.shiftKey\);\n\t\t\tif \(!target\) return;\n\t\t\tevent\.preventDefault\(\);\n\t\t\ttarget\.focus\(\);/);
	assert.match(wrap, /document\.addEventListener\("keydown", wrapTab, true\);\n\t\treturn \(\) => document\.removeEventListener\("keydown", wrapTab, true\);\n\t\}, \[editing\]\);/);
}

// Retry preview and Retry checks always send a request. A preview read that finds a newer saved
// entry refreshes the host entry once per version; the preview is read again only when it did not change.
{
	const statementText = (name: string) => savedVariable(name).getText(parsedSource);
	const gate = savedPanelDeclaration.body!.statements.find((item) => ts.isExpressionStatement(item) &&
		item.getText(parsedSource).includes("hostRefreshedVersions.current.add(newerSavedVersion)"));
	assert.ok(gate, "the automatic host refresh is one effect");
	class SavedContentChangedError extends Error {
		readonly sourceVersion: string;
		constructor(sourceVersion: string) { super("Saved content changed."); this.sourceVersion = sourceVersion; }
	}
	type Log = unknown[];
	const probe = compileProduction(`function retryProbe({ previewQuery, refreshHostEntry, savedVersion, hostRefresh = null, hostRefreshedVersions, log }) {
	const collection = "posts"; const entry = { id: "entry-1" }; const entryLocale = "en";
	const hostRefreshRequest = { current: 0 };
	const setHostRefresh = (value) => log.push(["state", value]);
	const effects = [];
	const React = { useEffect: (run) => effects.push(run) };
	${statementText("hostRefreshing")}
	${statementText("retryPreview")}
	${statementText("newerSavedVersion")}
	${gate!.getText(parsedSource)}
	${statementText("previewRefreshing")}
	return { retryPreview, newerSavedVersion, hostRefreshing, previewRefreshing, flush: () => effects.splice(0).forEach((effect) => effect()) };
}
module.exports = { retryProbe };`, { SavedContentChangedError }) as { retryProbe: (input: Record<string, unknown>) => {
		retryPreview: () => void; newerSavedVersion: string | null; hostRefreshing: boolean; previewRefreshing: boolean; flush: () => void } };
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	const run = (error: unknown, changed: boolean | null, versions = new Set<string>(), isFetching = false) => {
		const log: Log = [];
		const result = probe.retryProbe({
			previewQuery: { error, isFetching, refetch: () => { log.push("preview read"); return Promise.resolve(); } },
			refreshHostEntry: changed === null ? null : (...args: unknown[]) => { log.push(["host read", ...args]); return Promise.resolve({ changed }); },
			savedVersion: "shown-version", hostRefreshedVersions: { current: versions }, log,
		});
		const firstFrame = result.previewRefreshing;
		result.flush();
		return { log, result, versions, firstFrame };
	};
	{
		const { log, result, firstFrame } = run(new Error("Resolved metadata could not be loaded."), true);
		assert.equal(firstFrame, false, "an ordinary failure is shown as a failure");
		assert.equal(result.newerSavedVersion, null);
		assert.deepEqual(log, [], "an ordinary failure starts nothing on its own");
		result.retryPreview();
		assert.deepEqual(log, ["preview read"], "Retry reads the preview again");
	}
	{
		const versions = new Set<string>();
		const { log, result, firstFrame } = run(new SavedContentChangedError("newer-version"), true, versions);
		assert.equal(firstFrame, true, "a newer saved entry reads as updating in the render before its refresh starts");
		assert.equal(result.newerSavedVersion, "newer-version");
		assert.deepEqual(log.slice(0, 2), [["state", { from: "shown-version", done: false, changed: false }], ["host read", "posts", "entry-1", "en"]],
			"a newer saved entry refreshes the host entry once, on its own");
		await settle();
		assert.deepEqual(log.slice(2), [["state", { from: "shown-version", done: true, changed: true }]],
			"a changed host entry brings its own preview read, so none is sent here");
		const again = run(new SavedContentChangedError("newer-version"), true, versions);
		assert.equal(again.firstFrame, false, "after its one automatic refresh, the same newer version shows the failure and Retry");
		assert.deepEqual(again.log, [], "the same newer version is not refreshed again on its own");
		again.result.retryPreview();
		assert.deepEqual(again.log.map((item) => Array.isArray(item) ? item[0] : item), ["state", "host read"], "Retry always sends the host entry read");
	}
	{
		const { log } = run(new SavedContentChangedError("newer-version"), false);
		await settle();
		assert.deepEqual(log.at(-1), "preview read", "an unchanged host entry is followed by one preview read");
		assert.deepEqual(run(new SavedContentChangedError("newer-version"), null).log, ["preview read"], "without a host cache the preview is read again");
		assert.equal(run(new SavedContentChangedError("newer-version"), null, new Set(["newer-version"]), true).firstFrame, true,
			"that read again reads as updating while it is in flight");
	}
	const refreshing = (hostRefresh: unknown) => probe.retryProbe({ previewQuery: { error: null, refetch: () => Promise.resolve() }, refreshHostEntry: null,
		savedVersion: "shown-version", hostRefresh, hostRefreshedVersions: { current: new Set() }, log: [] }).hostRefreshing;
	assert.deepEqual([
		refreshing(null), refreshing({ from: "shown-version", done: false, changed: false }), refreshing({ from: "shown-version", done: true, changed: true }),
		refreshing({ from: "shown-version", done: true, changed: false }), refreshing({ from: "older-version", done: true, changed: true }),
	], [false, true, true, false, false], "the refresh shows as updating until the panel holds the new saved version or the host entry stayed the same");
	assert.match(savedPanelSource, /previewLoading=\{previewQuery\.isPending \|\| previewRefreshing\}\s*previewError=\{\(previewQuery\.isError && !previewRefreshing\) \|\|/,
		"a refresh in progress reads as Updating preview..., not as a failure");
	assert.match(savedPanelSource, /onPreviewRetry=\{retryPreview\}/);
	assert.match(savedPanelSource, /else retryPreview\(\);\n\t\};/, "Retry checks uses the same retry");
	assert.match(savedPanelSource, /<Button type="button" size="sm" variant="secondary" icon=\{ArrowsClockwise\} onClick=\{retryBasicChecks\}>Retry checks<\/Button>/,
		"Retry checks is a real button");
	assert.match(editorCss, /\.shipit-seo-native-panel-state--availability > a,\n\.shipit-seo-native-panel--sidebar \.shipit-seo-native-panel-state--availability > button \{\n  justify-self: start;/);
}

console.log("SEO native content extensions self-check passed.");
