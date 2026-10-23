# Editor and popup layout

The content editor combines a saved-content checklist, search preview and
separate editing controls. It preserves the
[native save boundary](editor-popup-contract.md) and the shared
[score policy](score-checklist-contract.md). Changing tabs does not start
server analysis, save history, contact a provider or change stored data.

Source references are relative to
`packages/emdash-plugin-seo/src/admin-ui/`.

## Sidebar

Analysis and Advanced are the two tabs. The tablist uses roving tabindex:
Left, Right, Home and End move focus; Enter or Space selects the focused tab.
Each tab controls its own panel.

Search preview is followed by the full-width Edit snippet button, which
opens Edit SEO on General. Social and Schema are secondary buttons that
open their matching dialog tab. They have leading feature icons and
`aria-haspopup="dialog"`, with no trailing window glyph. They are unavailable
until the preview loads. Closing the dialog returns focus to its opener.

The sidebar shows a phone search preview at a readable size. Its caption
carries the state: Saved values, Unsaved changes, Updating preview or
Last-loaded values. Device and result-page controls belong to the dialog.

Owners: `SeoEditorWorkflow` and `SearchPreview` in `content-extensions.tsx`,
and `search-social-preview.tsx`.

## Analysis

Opening an entry runs basic checks on saved content without enabling optional
server analysis or saving a collection profile. The header shows the score
or a truthful dash, checklist totals and one short scope note. Unsupported
body blocks cannot be made readable by changing the profile.

Analysis options is closed by default. It contains Analysis settings,
Saved analysis & history and the temporary session check. Save analysis,
its actual save scope and any unavailable reason stay in that disclosure.
Opening the entry or disclosure does not save a score, enable automatic
analysis or start a scan. Recovery notices and Reload saved keywords remain
visible when needed. Raw weights, partial point totals and profile-selection
internals do not appear in the summary.

Each checklist row shows its icon, label, status and finding without expansion.
The closed detail is clamped to three lines; expansion reveals the full
detail, recommendation, evidence and limitation. The action follows the
summary in keyboard order. At narrow widths it moves below the finding
rather than squeezing the label into the space beside it. Group totals and
row ordering come from the same shared presentation model.

Owners: `AnalysisScoreHeader`, `AnalysisScopeNote`, `AnalysisCheckRow`,
`SeoAnalysisDisclosure` and `SavedSeoEditorPanel`.

## Advanced

Controls are grouped by save scope:

- Saved with the entry: robots meta, canonical and read-only native values.
- Applies to the live page now: Nofollow links and advanced robots directives.

Entry indexing names the effective source: the entry's own Noindex,
site-wide Noindex, a content type rule, or Index allowed. When the site
default is known to allow indexing, it reads Index (site default).
Inherited noindex links to Indexing rules. The entry's own noindex uses a
warning; inherited restrictions use an information notice. Saving immediate
directives shows its pending state only in that group.

Owner: `AdvancedPanel` in `content-extensions.tsx`.

## Dialog and save area

The dialog is named Edit SEO; its tablist is Edit SEO sections. Desktop,
Mobile and Result page controls follow the tabs in keyboard order. A narrow
card reflows with a brief note while retaining the selected device's cut;
it does not add an inner horizontal scroller.

The footer is reachable from every tab and names each save scope.
Save SEO fields appears with a Changed line while native fields differ
from saved values. Save social text appears while the plugin Social draft
is dirty. Only one is primary: the native save when both are dirty, otherwise
the relevant save. Close is secondary.

Check saved SEO fields, Discard SEO edits, Check saved social text and native
conflict choices sit in the secondary footer area. Native status is visible
on General and Social, and on Schema while native changes or recovery need
attention. General and Social columns do not duplicate these save buttons.

Owners: the dialog footer and `SocialPreview` in `content-extensions.tsx`,
plus `native-seo-editor-fields.tsx` and `native-seo-editor-state.ts`.

## Fit estimates and sharing

Nonblank SEO title and description fields show phone and desktop fit
estimates from `../snippet-fit.ts`, also used by the preview and checklist.
The character counter adds its input limit only within 10% of that limit.
An empty inheriting field has no fit meter.

Cuts prefer the last whole word within 20 graphemes of the fitted width;
a longer word is cut where it overflows. The displayed publication date
shares the description's line budget. Fit text names the device and stays
an estimate, without an error state.

The primary keyword is emphasized in search descriptions using the analyzer's
case-insensitive phrase matcher. Secondary keywords and titles are not
emphasized. Text that cannot be mapped back exactly stays unchanged. The
emphasis preserves the measured text width and accessible text.

Social places its preview first in the DOM and in the wide layout. The
Sharing image card precedes Customize for social and gives landscape-image
guidance, for example 1200 x 630 px. Facebook and X controls change only the
preview.

## Maintainer checks

Check light and dark themes, keyboard-only use and narrow sidebar and dialog
widths without horizontal page scroll. Verify tab selection, opener focus
return, complete row labels, one primary save and scope-specific feedback.
Exercise native and Social drafts across tab changes, conflict recovery and
lost acknowledgements. Host-owned panels may place Advanced SEO below the
fold; the plugin must not reorder those panels.

CSS owners: `content-editor.css` and `admin.css`. Platform and lifecycle
qualification is recorded in [compatibility](compatibility.md).
