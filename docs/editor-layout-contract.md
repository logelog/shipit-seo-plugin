# Editor and popup layout (E1-E6, P1-P3)

## Scope

Base: candidate `0.4.0-beta.41` with analyzer 21
(`score-checklist-contract.md`) and the native save boundary in
`editor-popup-contract.md`. This change rearranges the content editor
sidebar and the snippet dialog. It does not change scoring, check rows,
weights, limits, saved data, request shapes or the analyzer and admin
contract versions. No provider request, scan, history write, host patch,
private editor bridge or new dependency is added. Typography, colour
tokens, corners, the brand label and the existing keyword field stay.
Only existing Kumo components and Phosphor icons are used.

Source paths are under `packages/emdash-plugin-seo/src/admin-ui/` unless
stated. Every item also keeps light and dark mode, keyboard-only use and
1280px and 375px widths without horizontal page scroll.

## Items

**E1. Analysis and Advanced are tabs; Social and Schema open the dialog.**
The strip is a `tablist` with two tabs, Analysis and Advanced
(`aria-selected`, roving `tabindex`, Left/Right/Home/End move focus,
Enter or Space selects). Each tab controls a `tabpanel`. Under the search
preview, two secondary buttons, Social and Schema, carry a trailing dialog
glyph and `aria-haspopup="dialog"`, open the dialog on that tab and stay
disabled with a tooltip until the preview loads. Closing the dialog returns
focus to the button that opened it.
Files: `content-extensions.tsx` (`SeoEditorWorkflow`), `content-editor.css`,
`admin.css`. Save scope: none.
Browser checks: exactly two tabs; arrows move focus and Enter or Space moves
`aria-selected`; Social and Schema open the matching dialog tab; focus
returns to the clicked button; nothing wraps or overflows at the narrowest
sidebar width.

**E2. Name the trigger and the dialog after what they do.** The trigger
under the snippet reads Edit snippet, is a full-width secondary button and
always opens the dialog on General. The dialog title is Edit SEO. The
sidebar heading reads Search preview and carries no state text. The preview
card's caption holds the one preview status line: Saved values, Unsaved
changes, Updating preview... while a newer saved version loads, or
Last-loaded values after a failed refresh.
Files: `content-extensions.tsx` (`SearchPreview`), `search-social-preview.tsx`
(`PreviewSummary`), CSS. Save scope: none.
Browser checks: button text and dialog heading match; a screen reader
announces the dialog as Edit SEO; checklist row actions still open the
dialog on the right field.

**E3. Rows show the finding without expanding.** A row summary shows the
icon, label and status word on line 1 and the check detail on line 2,
clamped to three lines while closed. The expansion keeps the
recommendation, the evidence basis and the limitation. The row action stays
at the row end. Row order, group pills and totals are unchanged.
Files: `content-extensions.tsx` (`AnalysisCheckRow`), `content-editor.css`.
Save scope: none.
Browser checks: a failed or partly met row shows its sentence without a
click; expanding shows the recommendation and the full detail; pill counts
and header totals are unchanged; Tab reaches the summary, then the action.

**E4. Automatic basic checks; saved analysis under Analysis options.** The
score header shows the current score or a truthful dash and the checklist totals.
One short note explains which saved content is checked, why a complete score
cannot be shown, or that more page text is needed. The editor does not display
raw weights, partial point totals, profile fallback internals or calculation
disclaimers. Unsupported custom blocks remain partially checked; changing an
assessment profile does not make their content readable.

Basic checks still run on entry load without enabling automatic analysis or
saving a collection profile. Analysis options remains closed by default and
contains Analysis settings, Saved analysis & history and Temporary session
check. The explicit **Save analysis** action sits in Saved analysis & history,
with its scope and unavailable reason. It keeps the same admission, saved-entry
mutation, pending state and unknown-write recovery. Opening the entry or this
disclosure does not save a score, enable automatic analysis or start a scan.
Result notices and Reload saved keywords remain visible below the header.
Files: `content-extensions.tsx` (`AnalysisScoreHeader`, `AnalysisScopeNote`,
`AnalysisHeader`, `SeoAnalysisDisclosure`, `SavedSeoEditorPanel`). Save scope:
unchanged.
Browser checks: saved Portable Text gets the same score with automatic analysis
off and no selected profile; unsupported blocks keep a dash with a short reason;
there is no technical calculation disclosure or disabled Analyze button above
the keywords. Save analysis and its reason appear only when Analysis options is
opened; keyboard access and recovery remain intact.

**E5. Advanced grouped by save scope.** Two headed groups with one-line
scope notes: Saved with the entry (robots meta, noindex note, canonical,
read-only core values) and Applies to the live page now (Nofollow links and
the advanced robots directives). The Index option reads Index (site
default) when site-wide noindex is known to be off. When it is on, a note
links to the Indexing rules view. The applied-canonical text has no em dash.
Files: `content-extensions.tsx` (`AdvancedPanel`), CSS. Save scope:
unchanged; draft fields still go through `updateSeo`, directives through
their immediate save.
Browser checks: both headings visible; toggling a directive shows Saving
robots directives... only in the second group; Noindex shows its note; with
site noindex on, the note and link appear; no em dash in the canonical text.

**E6. Emphasise the primary keyword in previews.** Case-insensitive
whole-phrase matches of the primary keyword are bold in the search preview
description, in the sidebar and the dialog, using the analyzer's own phrase
matcher (`src/keyword-match.ts`). Secondary keywords are not bold. Titles
are not bold: Google bolds query terms in snippets rather than title links,
and the shared fit model measures regular-weight titles. Text content and
accessible names are unchanged; text the matcher cannot map back exactly is
shown without emphasis. The emphasis is drawn as a thin text stroke at
regular weight, so emphasised words keep the advances the fit model measured.
Files: `search-social-preview.tsx`, `content-extensions.tsx`,
`src/keyword-match.ts` (new range helper only). Save scope: none.
Browser checks: with the keyword in the description, the phrase is bold in
both previews; removing the keyword removes it; secondary keywords stay
regular; no horizontal scroll appears in either preview.

**P1. One scope-labelled save area in the dialog footer.** The General and
Social columns hold no save buttons. The footer, reachable from every tab,
shows Save SEO fields with a Changed: line (for example Changed: SEO title,
Sharing image) while native fields differ from their saved values, and Save
social text while the plugin Social draft is dirty. Only one button is
primary: the native save when native fields changed, otherwise the social
save. Close is always secondary. Check saved SEO fields, Discard SEO edits,
Check saved social text and the native conflict review sit in the footer
secondary area. Native status and recovery show on General and Social, and
on Schema only while a native change, attempt, conflict or field error is
outstanding, or after a confirmed save until the next edit.
Files: `content-extensions.tsx` (dialog footer, `SocialPreview`),
`native-seo-editor-fields.tsx`, `native-seo-editor-state.ts` (read-only
changed-field helper), `admin.css`. Save scope: unchanged. Native saves stay
changed-fields-only guarded writes with revision and locale, confirmed by
readback, with drafts kept on timeout, conflict or unknown outcome and no
automatic retry. Social text keeps its separate save and conflict path.
Browser checks: edit the title and switch to Social; the footer still offers
Save SEO fields with Changed: SEO title; saving shows SEO values saved and
checked.; editing only the social title gives a primary Save social text;
editing both shows two save buttons, one primary; stale-revision and
lost-acknowledgement paths keep the edits.

**P2. Live fit estimate under SEO title and Meta description.** The field
counter reads N characters and adds the input limit only within 10% of it.
Under a non-blank field, a two-segment phone and desktop meter and one line
read Fits phone and desktop (estimate) or May be cut on phone after
"..." (estimate), using `seoSnippetFit` and `seoSnippetCutPoint` from
`src/snippet-fit.ts`, the same estimate as the Title fit and Description
fit rows. There is no error state. A blank, inheriting field shows no
estimate.
Files: `native-seo-editor-fields.tsx`, CSS. Save scope: none.
Browser checks: typing a long title switches the text live; after save and
Analyze, Title fit agrees with the estimate for the same text; a blank field
shows the inherited placeholder and no estimate; dark mode stays readable.

**P3. Social tab order and image guidance.** The share preview comes first
in the DOM and in the wide layout. In the settings column the Sharing image
card comes before Customize for social and shows "Use a landscape image, for
example 1200 x 630 px."
Files: `content-extensions.tsx` (`SocialPreview`),
`native-seo-editor-fields.tsx`, `admin.css`. Save scope: none.
Browser checks: below a 760px dialog width the share preview is first; the
image card is first in the settings column; with no image, Choose image and
the guidance show; the Facebook and X switch still updates the preview.

**R. Corrections after installed review.** These refine the items above;
where they differ, they apply.
- E1: the opener glyph is Phosphor `AppWindow`, a dialog glyph, never an
  external-link glyph.
- E2: the dialog tablist is named Edit SEO sections. Desktop, Mobile and
  Result page follow the tabs in focus order; the header grid shows them
  beside the title. The sidebar always shows the phone preview, reflowed at
  readable sizes; only the dialog offers both devices.
- E3: the heading never wraps. A long label is shortened with an ellipsis on
  line 1 while the row is closed, so the status word stays on line 1; the open
  row shows the whole label.
- E3 (narrow panel): this refines the ellipsis rule above. Rows keep the icon,
  the whole label and the status word on line 1. At narrow panel widths the
  row action moves to the row end below the finding instead of reserving space
  on line 1; Tab order and the action's accessible name are unchanged.
- E4: the Analyze title is always set, to the helper sentence or the reason it
  is disabled. While the inputs of the shown browser checks reload, the header
  keeps the last result with an Updating checks... line instead of a dash.
- E4 (host layout): EmDash places the SEO panel below its own sidebar panels
  (Publish, URL, Ownership, Bylines and Taxonomies), so at 1280x800 Analyze
  starts below the fold. The plugin cannot reorder host panels; the browser
  check reads that the button is visible once the sidebar is scrolled to the
  SEO panel. Kumo shows a button title only as a hover tooltip, so the helper
  sentence or disabled reason is also the button's description
  (`aria-describedby`).
- E5: the read-only Entry indexing row names the state the page gets: Noindex
  for the entry's own setting, else Noindex from site-wide setting, else
  Noindex from content type rule, else Index (site default) when the site
  default is known, else Index allowed. Advanced status text is at least
  11 px, using the panel's dark pill tones in dark mode.
- E6 and P2: a preview cut falls at the last space within 20 graphemes of the
  fitted width; a single longer word is cut where it overflows. The
  description estimate measures the publication date the preview shows before
  it, as Description fit does. Where the dialog is narrower than the device
  card, the card reflows with a short "Reflowed to fit this screen" note and
  keeps the device's cut, with no inner scroller.
- P2: the Social title and description counters use the native counter
  format.
- Small editor text uses existing tokens: the saved-analysis note and the
  unselected device toggle use the subtle text token on the tint surface, and
  dark row actions use the link token.
- E4 and E5: Metadata ownership and Analysis options use the same chevron as
  the check groups instead of the browser's disclosure triangle. The inherited
  content type rule note is information, on the info banner surface with an
  info icon that never shrinks; only the entry's own noindex keeps the warning
  colours.
Files: `content-extensions.tsx`, `search-social-preview.tsx`,
`native-seo-editor-fields.tsx`, `src/snippet-fit.ts`, `src/snippet-metrics.ts`,
`admin.css`. Save scope: unchanged.

## Verification

Selfchecks cover each item: tab roles and keyboard roving, opener focus
return, footer saves on every tab with one primary, fit text and limit
threshold, keyword emphasis ranges, Social order, row summaries, the header
action and the Analysis options sections. Browser checks above need the
installed fixture before acceptance.

## Documentation impact

Customer labels change. `packages/emdash-plugin-seo/README.md` and
`INSTALL-PROMPT.md` name View previews, Save SEO, Save social metadata and
Analyze this entry; they need Edit snippet, Save SEO fields, Save social
text, the header Analyze button and Analysis options. The layout change
belongs in the beta.42 `CHANGELOG.md` entry, not beta.41. Architecture,
permissions and operating cost are unchanged because no request, store or
write path changes.
