# Admin navigation and settings structure (N1-N13, I1)

## Scope

Base: candidate `0.4.0-beta.41` with the editor layout in
`editor-layout-contract.md`. This change reorganises the workspace rail,
the settings action bars and a few settings pages. It does not change
saved data, permissions or scoring. The only request change is the
Feature controls revision guard (N4): its save and restore name the module
record's revision, within admin contract version 45, and the module
configuration reports `revision` and `writable`. No provider request,
scan, host patch or new dependency is added;
the only new read is the existing plugin inventory read, made once per
admin page session for the N6 notices. Nothing inside Shipit deactivates
another plugin or imports its data.
Typography, colour tokens, corners, the brand label and the logo stay. Only
existing Kumo components and Phosphor icons are used.

Source paths are under `packages/emdash-plugin-seo/src/admin-ui/` unless
stated. Every item also keeps light and dark mode, keyboard-only use and
1280px and 375px widths without horizontal page scroll or new inner
scrollbars. Data impact for every item: none, apart from the existing save
or restore that the user confirms.

## Items

**N1. One navigation model with visible group headings.** The rail and
the compact page Select are built from `SEO_WORKSPACE_NAV_GROUPS` only.
Groups, in order: Overview (no heading); Content (Work queue, Content
health, Trends); Search appearance (Templates, Search & social, Schema,
Local SEO); Indexing (one row without a heading, I1); Settings (Feature
controls, Site verification, Migration when listed, Export & import).
Migration is listed once the
overview reports legacy records or migration history, while it is open and
for the rest of the admin page session after it was opened. While the
overview has not been read, it is not listed, so the row is only ever added
and never shown and then removed (`seoWorkspaceHiddenViews`). Schema library opens from Schema
and Website opens from Local SEO, so neither has its own rail row; both
stay in the compact Select and in search. Every `?view=` value opens the
same page as before.
Files: `workspace-model.ts`, `workspace-shell.tsx`, i18n `nav.*`.
Browser checks: at 1280px three headings show (Content, Search appearance,
Settings) with the Indexing row before Settings, and Search & social sits
under Search appearance after Templates; at 700px the Select lists the
same groups under Content, Search appearance, Indexing and Settings; each
existing deep link opens its page.

**I1. One Indexing row and the Indexing tools list.** The Indexing group
has no heading and one rail row, Indexing (`data-rail-group="indexing"`,
labelled by `nav.group.indexing`), which opens the first visible tool,
Indexing rules. The row has `aria-current="page"` while Indexing rules is
open and `aria-current="true"` while another indexing tool is open; a click
on it then does nothing, as on a parent row. The rail has no disclosure.
Every indexing page, at every width, starts with the Indexing tools list
(`IndexingNavigation`, named by `nav.indexingTools`): the visible tools from
`seoWorkspaceIndexingTools`, each with its icon and label, in this order:
Indexing rules, Sitemaps, Robots.txt, llms.txt, IndexNow, Crawl diagnostics,
Redirects & 404s. The open tool has `aria-current="page"` and a click on it
does nothing. The list wraps onto further rows instead of scrolling sideways,
and the open tool is marked by text weight as well as colour. When focus is in
the list and the open page leaves Indexing, focus moves to Find a setting.
Choosing a tool changes only the route: the Indexing rules form stays
rendered in its hidden settings pane, with passive reads, and kept draft
pages stay mounted as in N11, so no other form is remounted, reset or saved.
A page change scrolls only the nearest scroll container, or the document,
and only while the workspace top is above its visible area
(`seoWorkspaceTopScroll`); an overflow-hidden host ancestor is never scrolled,
and the plugin root contains its visually hidden text.
Search results and the compact Select still list every visible tool, and a
hidden page is left out of the rail row, the list and the Select alike.
Files: `workspace-model.ts`, `workspace-shell.tsx`, `admin.tsx`, `admin.css`,
`content-type-indexing-container.tsx`, `taxonomy-indexing-container.tsx`.
Browser checks: at 1280px the Indexing row opens Indexing rules; at 375px,
where the compact Select replaces the rail, the Select opens Indexing rules;
at both widths the tools list shows above the page without sideways scrolling;
each of the seven tool links opens its page and is the only one marked; with
an unsaved Robots.txt draft, opening Sitemaps and returning keeps the draft
and writes nothing; with an unsaved Indexing rules choice and How these rules
work open, opening Sitemaps and returning keeps the same form, the choice and
the open help; after each tool choice the EmDash header stays in view; at
700px the Select and the list both navigate; Tab runs through the rail, then
the tools list and the content.

**N2. Template content-type selector without sideways overflow.** With up
to four content types, a vertical list of types sits beside the template
fields when the form is at least 600px wide; below that width a Select is
used. With more than four types the Select is always used. A type with
unsaved edits reads "(edited)" in both. Switching keeps each type's draft.
Files: `template-views.tsx`, `template-editor-model.ts`, `admin.css`.
Browser checks: with 8 content types there is no horizontal scroll at
1280px or 375px; the edited marker shows after a change; switching type
keeps each draft.

**N3. Insertable template variables and per-field examples.** Variable
chips are buttons. A chip inserts `{{variable}}` at the caret, replacing a
selection, of the template field focused last (SEO title when none was
focused yet), returns focus there with the caret after the token, and the
form reads Unsaved changes. After a settled Preview each field shows
"Example: <resolved value>" from that preview result; a stale preview shows
no examples.
Files: `template-views.tsx`, `template-editor-model.ts`.
Browser checks: focus Meta description, click `{{title}}`: the token
appears at the caret and the form is unsaved; after Preview all four
fields show their example lines; Discard removes the insertion.

**N4. One action bar layout.** `SettingsActionBar`: the page's restore
action at the left as a secondary-destructive button that always opens a
confirmation; at the right the status text, Discard changes and the
primary Save <object>. Discard and Save are unavailable while nothing is
unsaved or a write runs: they carry `aria-disabled`, not the native
`disabled` attribute, so a pressed button keeps keyboard focus, and their
click does nothing; an unavailable Save also cancels the form submission,
and the loader that replaces its icon while it saves is hidden from
assistive technology, so its name stays the Save label. Dimmed at half
opacity, they return to full opacity while focused, so the focus ring
keeps 3:1, and an unavailable Discard keeps its resting background on
hover, as a natively disabled Kumo button does. Restore stays in place but
is disabled while nothing is stored to restore or the page's existing
restore rules block it.
Pages: Search & social and Website (Restore inherited; Save search &
social settings, Save website settings), Indexing rules (no restore exists
for this record, so the slot stays empty; Save indexing rules), Feature
controls and Schema defaults (Restore inherited; Save modules, Save
presets), Sitemaps (Restore defaults, now disabled while nothing is stored;
Save sitemap settings; Discard changes returns the form to the saved
choices), Robots.txt (Restore default, disabled while nothing is stored,
also when only an unsaved draft exists; Save robots.txt; Discard changes
returns the editor to the stored text) and Templates (Use inherited, only
for a type with its own template and no unsaved edits; Save template).
Restore requests and their dialogs are unchanged; Discard never writes.
Feature controls Save modules and Restore inherited name the module
record's storage revision (`expectedRevision`, null while nothing is
stored) and the engine writes or deletes it with a compare-and-set on that
revision. A changed record is refused with `conflict` and nothing is
written; the switches are kept until Reload latest or Discard changes,
which read the record again. Nothing retries. A host without conditional
storage reports `writable: false`, and the switches, Save and Restore stay
off. On Search & social, Website, Indexing rules, Sitemaps and Feature
controls, a save whose result is unknown, such as after a lost response or
a timeout, reads Save not confirmed instead of not saved: the draft is kept
and Save stays blocked until a reload read succeeds. While that read runs
and when it fails, the lock, the draft and the page stay. Search & social,
Website and Indexing rules (`SettingsSectionContainer` in `admin.tsx`) show
the error view only when a read failed with nothing loaded, the rule of the
Modules and Sitemap containers; after a failed reload read the reload banner
adds an alert that the saved settings could not be read, and its Reload saved
settings button shows its read is running and sends no second read while it
runs (`SettingsReloadBanner`). Sitemaps and Feature controls take the record
their `onReload` read returns, keep the draft when
its revision is the one the draft started from, and show the stored
choices when it is newer. A definite 4xx
refusal other than a timeout, conflict or rate limit reads not saved.
Every confirmation dialog uses one layout
(`shipit-seo-delete-dialog`: 20px padding, a 16px semibold title).
Files: `settings-action-bar.tsx`, `admin.tsx`, `configuration-views.tsx`,
`sitemap-view.tsx`, `robots-txt-view.tsx`, `template-views.tsx`, `admin.css`.
Browser checks: on each page restore is leftmost, Save is the rightmost
primary, both carry `aria-disabled` when clean, Discard keeps focus after
discarding and Save while it saves, and restore always asks first; after
a save is not confirmed, a failed reload read keeps the form, its draft and
the lock, with the failure shown inline.

**N5. Feature controls: module links and save-mode labels.** Each module
saved on (not a pending toggle) shows a ghost Open button: Schema opens
Schema, Sitemaps opens Sitemaps, 404 Monitor opens Redirects & 404s and
Image alt checks opens the Work queue with the images scope, all without a
page reload. The module form carries a "Save to apply" badge; Automatic &
bulk analysis and Publisher schema & Local SEO carry "Saves immediately".
Files: `configuration-views.tsx`, `content-scoring-controls.tsx`,
`publisher-ownership-view.tsx`, `admin.tsx`.
Browser checks: links appear only after a module is saved on and navigate
without a reload; badges are visible; unsaved toggles do not change links.

**N6. Overlapping SEO plugins.** Feature controls lists one row per active
overlapping plugin (a registry and a configured copy of one plugin share a
row): name, version, assessment and "Paused in Shipit: ...", then one
Manage plugins link (host plugins page) and Check again. With no overlap,
no unassessed plugin and no unchecked configured plugin it shows "No
overlapping SEO plugins found" and Check again. Absent or inactive plugins
are never listed. A compact one-line notice with a Review button (opens
Feature controls) shows only when an active plugin overlaps: on Overview,
and on the pages whose output is paused (metadata: Search & social and
Templates; robots meta: Indexing rules; schema: Schema and Schema library;
IndexNow: IndexNow). Sitemaps and Robots.txt are not coexistence surfaces,
so they show no notice. One shared read per admin page session serves all
notices; Feature controls and Check again read again.
Files: `plugin-coexistence-view.tsx`, `plugin-coexistence-model.ts`,
`configuration-views.tsx`, `admin.tsx`, `admin.css`.
Browser checks: with an overlap fixture Feature controls shows one row per
plugin with its paused features, Schema shows "Paused while <plugin> is
active"; with no overlap the positive line shows and no other notice does.

**N7. Settings search matches setting names.** The rail search also
matches 45 setting labels from `SEO_SETTINGS_SEARCH_INDEX` (view and
optional field). Results read "<setting> (<page>)". Selecting one opens
its page and, when the setting has a field, focuses it (opening an
enclosing disclosure first). Page matches keep their rows. Escape clears.
Files: `workspace-model.ts`, `workspace-shell.tsx`, the views that carry
`data-seo-setting` fields, i18n `nav.setting.*`.
Browser checks: "bing" finds "Bing verification code (Site verification)"
and selecting it focuses the Bing input; "excluded" finds Sitemaps; Escape
clears; the empty state is unchanged.

**N8. Verification: inline tag shape and scope-labelled saves.** Under
each provider input the tag EmDash adds is shown as live code built from
the current draft, or from a placeholder while empty. `<details>` remains
only for the previously loaded tag of an unconfirmed save. A visible help
line says that EmDash Settings > SEO edits the same Google and Bing fields
and links there. The saves read "Save Google and Bing codes" and "Save
custom tags", each with a line naming what it saves. Discard changes sits
before Save Google and Bing codes, as in the shared action bar, and only
returns both codes to their stored values.
Files: `site-verification-view.tsx`, `custom-verification-view.tsx`,
`workspace.css`.
Browser checks: typing a code updates `<meta name="google-site-verification" ...>`
live; pasting a full tag still offers "Use code X"; both save labels are
visible and each saves only its own store.

**N9. Overview without a duplicate settings grid.** The six-card Settings
grid is removed. Setup details is open by default with its Open buttons.
The N6 compact notice shows at the top when an overlap exists.
Files: `overview-view.tsx`, `admin.tsx`.
Browser checks: no card grid; setup checks visible without a click; the
overlap line appears with an overlap fixture.

**N10. One destination for unreadable settings.** `SEO_SETTINGS_UNREADABLE_VIEW`
(Indexing rules) is used by the workspace banner, the Overview next step
and the Content health message, which offers an in-app Open button.
Files: `workspace-model.ts`, `admin.tsx`, `overview-model.ts`,
`content-scoring-controls.tsx`.
Browser checks: with an unreadable-settings fixture all three open
Indexing rules.

**N11. Unsaved drafts stay for the session.** Search & social, Website and
Indexing rules keep their overrides in the workspace owner; Schema stays
mounted once visited; Templates, Local SEO and custom verification tags
keep their drafts in stores outside the page. The remaining form pages,
`SEO_WORKSPACE_DRAFT_VIEWS` (Feature controls, Sitemaps, Robots.txt,
llms.txt, IndexNow, Site verification), report through
`useWorkspaceDraftHold` whether a form holds unsaved edits, a write in
flight or an unresolved outcome. Moving to another page keeps such a page
mounted and hidden, with its draft, the revision it started from and any
conflict or unknown outcome; a page with nothing held unmounts as before,
so it reads its stored state again when it is next opened. A hidden page
closes its dialogs (`useWorkspacePageActive`). Nothing is saved, retried
or discarded by moving between pages; leaving or reloading the admin page
drops the drafts.
Files: `admin.tsx`, `workspace-shell.tsx`, `workspace-model.ts`, the six
views, `admin.css`.
Browser checks: type in Robots.txt, llms.txt and Sitemaps excluded paths,
open another Indexing tool and come back: each draft is still there and
nothing was written; a clean page reloads its stored state.

**N12. Narrow layouts follow the workspace width.** The host sidebar and
the rail narrow the workspace before the viewport, so these use workspace
container queries: the Work queue filters show the search on its own row
and three selects under it at 840px and below, one column at 560px and
below; Sitemaps stacks its status panel under the form at 700px and below,
like Robots.txt and llms.txt, so Save stays beside Discard; at 560px and
below Feature controls rows put the controls under the description, the
Local SEO Review facts put each value under its label, and tab strips
(Redirects & 404s, IndexNow, Schema, 404 activity, Crawl diagnostics,
Schema draft and Local SEO output) wrap onto further rows with the
indicator under the active tab (`workspace-tabs.ts`), because Kumo hides an
overflowing strip's scrollbar. Local SEO grid tracks are `minmax(0, 1fr)`,
so no Review fact can widen the panel.
Browser checks: at 1280px the Work queue filters are not clipped and the
Sitemaps bar keeps Save beside Discard; at 375px every tab is visible and
the Review status badge and Entity ID fit.

**N13. Names, primary actions and quiet notices.** Each Index or Noindex
radio group in an Indexing rules list is named by a legend that includes
its item ("Search visibility for Posts", "Search visibility for
Categories archive pages"), so no two groups in a list share a name
(`local-seo-indexing-contract.md`, I2). The llms.txt switch label reads Output on or Output off (saved
setting). Local SEO Next and the Review save, Save redirect and Save
changes, the llms.txt Save, Save content types, Save advanced settings and
Start automatic submission are primary. A settings section save reports in
its status beside Save without a toast. The Work queue intro and helpers
use 13px and 12px left-aligned text with one row of actions. External
links keep their icon beside the text, and an address breaks after a slash
before it breaks inside a word.

## Documentation impact

The README workspace navigation section, the 0.4.0-beta.48 CHANGELOG
entry and INSTALL-PROMPT now describe the rail grouping and the Indexing
row and tools. Customer documentation (README, UPGRADE, CHANGELOG,
INSTALL-PROMPT) still needs the settings search, the Feature controls
Open links and save-mode badges, the overlap rows and notice, and the
verification save labels. That pass is owned by the later documentation
change for this release and is not part of this source delta.
Architecture and permissions are unchanged.
