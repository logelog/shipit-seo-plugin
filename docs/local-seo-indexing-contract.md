# Local SEO and Indexing pages (L1-L3, I2-I8, content type rule)

## Scope

Base: candidate `0.4.0-beta.41` with `admin-navigation-contract.md`. This
change reorganises the Local SEO flow and the Indexing tools and adds one
additive, versioned indexing setting: a noindex rule per content type.
Typography, colour tokens, corners, the brand label and the logo stay. Only
existing Kumo components and Phosphor icons are used. No provider request,
scan, host patch or dependency is added, and nothing writes another
plugin's data.

Source paths are under `packages/emdash-plugin-seo/src/` unless stated;
`AU/` is `admin-ui/`. Every item keeps light and dark mode, keyboard use
and 1280px and 375px widths without horizontal page scroll.

## Local SEO

**L1. Numbered steps with completion markers; Website as a summary.** The
Local SEO sub-navigation lists only the identity steps, numbered
"1 Identity" to "6 Review and save". With a draft, each step shows a done
or needs-attention marker (an icon with a translated accessible label),
derived from the same client validation as "Fix these before saving"
(`draftErrors` mapped by `stepForField`) plus the server's field errors
from the last refused write. Website
leaves the sub-navigation and becomes a summary card at the top of the
Identity step: the saved website name and production URL, an "Unsaved
changes" note while the Website form holds edits, and Edit website, which
opens the Website form. That form gains "Back to business identity". The
two saves stay separate: Save website settings stores only the settings
record and the identity draft is kept in its store.
Files: `AU/business-identity-view.tsx`, `AU/admin.tsx`, `AU/admin.css`.
Browser checks: with a draft six numbered steps show; clearing Public name
marks Identity "Needs attention"; the card shows the saved values; Edit
website, Save, Back keeps the identity draft.

**L2. Step footer.** Steps 1 to 5 show Previous at the left and Discard
changes and a primary Next at the right; Review shows Previous, Discard
changes and the save label as primary. Turn off or on and the entity
transitions move into a "Status and entity" section of the Review step,
with unchanged conditions, confirmations and revision guards. Enter in a
field still opens Review before anything is written.
Next and the Review save use the primary button variant. Review facts sit
in `minmax(0, 1fr)` tracks; at a workspace width of 560px and below each
value sits under its label, and the Entity ID note is its own line in
regular weight, so the status badge and the ID never run past the panel.
Browser checks: steps 1 to 5 have no Turn off/on or transition buttons;
Review shows them with the save; Tab order is Previous, Discard, Next; at
375px the Review content is no wider than the panel.

**L3. Logo guidance and kind-dependent fields.** Logo reads "Square image,
at least 112 x 112 px." For a person, legal name, logo, countries served,
address and service area, location, hours and price range are hidden or
replaced by a one-line note; switching back to an organization or local
business shows the draft values again, because the draft keeps every
typed value and only the request leaves them out.

Duplicate settings review: each field already has one editing owner.
Website name and production URL belong to the Website form (settings
record); the publisher's name, logo, profiles and address belong to the
business identity record; Search & social keeps the default social image
and X attribution and links to the Local SEO Social step. Nothing is
merged and no field is removed: the legacy publisher fields in the
settings record stay stored and keep feeding the setup prefill and the
fallback publisher. The Local SEO summary card only reads the Website
values.

## Indexing

**I2. Indexing rules: content types and taxonomy archives.**
The page has a heading without a description, then a prominent
"Site-wide" block, then "Content types" and "Taxonomy archives", then a
closed `<details>` "How these rules work", the reload notice, form errors
and the action bar. "Content types" lists each public content type,
custom types included, from the existing sitemap configuration query,
with one "Edit in Sitemaps" button in the section head. Every
search-visibility choice, site-wide included, is an explicit two-option
Kumo `Radio.Group` (horizontal) "Index" / "Noindex", never a switch;
each group is named by a visually hidden legend ("Search visibility for
<type>", "Search visibility for <taxonomy> archive pages", "Site-wide
search visibility"), and the site-wide wrapper keeps
`data-seo-setting="siteNoindex"` for Find a setting, which focuses the
checked option, because focusing another option can select it. Noindex
adds the name to `contentTypeNoindex` or the existing
`taxonomyArchiveNoindex` list, so the stored semantics and the export
are unchanged. "Set all to Noindex" and "Set all to Index" replace Hide
all and Show all with the same all-or-nothing limit; a read-only archive
list shows no limit message. Rows show the label only, without the key
or per-row sitemap text.

Status model (`AU/indexing-rules-model.ts`, pure): the effective state
of the saved values and of the draft is site-wide noindex first,
otherwise the item's own rule, with the source Site-wide rule, Content
type rule or Archive rule. Each row shows the saved effective state as
text with an icon ("Index", or "Noindex" with its source). Only when the
draft would change it, a second line reads "After saving: <state>" with
an "Unsaved" tag, so a pending choice never reads as live behaviour.
After a save whose outcome is unknown the stored settings may already
hold the draft, so until they are read again that tag, and the tag of a
kept rule, reads "Save not confirmed".
Editability follows the draft: while it has site-wide noindex, a note
says the site-wide rule overrides the rules below, and each content type
and archive row is read-only and shows "Own rule kept: <choice>"; the
stored per-type and per-archive lists are never rewritten and apply
again once site-wide is Index. "Index" on a type is never described as a
guarantee: an entry can still add its own noindex. "How these rules
work" holds the precedence, the sitemap facts the rows used to repeat,
whether this plugin serves the sitemap (from the same sitemap read;
nothing is claimed before it loads), that archive rules never add
noindex to the entries that carry these terms and apply only on archive
templates that use this plugin's archive integration, and that robots.txt
is configured separately. The taxonomy archive section's own text is
translated in en, nl and tr, including the fixed message for unavailable
taxonomy definitions; validation messages from the settings contract and
the server stay in English.

Content type rule storage: `contentTypeNoindex?: string[]` in the
existing settings record (`settings:global:v1`, storage version 1). It is
optional and presence-aware like `taxonomyArchiveNoindex`: absent in older
records, sorted and unique, at most 100 exact collection keys
(`^[a-z][a-z0-9_-]{0,63}$`); a malformed stored value makes the record
corrupt instead of being guessed. Saves keep the revision guard. A kept
draft list holds only its own added and removed names
(`rebaseIndexingNameLists`): whenever the stored settings under it
change, from a read, a save on another settings page or the read after a
conflicting save, those names are applied to the newer stored list, so
rows this editor did not change show no "After saving" line and the next
save keeps the other editor's names. A save
from a client that omits the field keeps the stored list; Restore
inherited keeps it; newly added names must be current content types,
while kept names of removed types stay visible by name and can be
removed. Export includes the list when present; import of a bundle
without it keeps the current list; newly restricted types are a
destructive import change with a warning.

Precedence, shown on the page and in the editor: site-wide noindex, then
the content type rule, then the entry's own noindex. Each only adds
noindex. The page shows this order in How these rules work. An entry of a ruled type cannot opt back in, because the native
entry noindex is a boolean that can only add noindex.

Output: entries of a ruled type render `noindex,nofollow` robots meta like
the other noindex sources; their type gets no child file in the sitemap
index, its child file answers 404 and its stored sitemap choice is kept
and marked "Noindex rule" on the Sitemaps page; automatic IndexNow skips
them and its content types help says so; the analyzer indexability row names "the
content type rule in Indexing rules"; the editor Advanced panel
shows the inherited state with a link to Indexing rules. Saved analyses
of other types keep their input identity; saved analyses of a ruled type
read as stale after the rule changes.

Unless plugin coexistence pauses the plugin's robots output, a page carries
at most one robots meta tag in EmDash's head output: the plugin's comes first
and the host keeps the first. The plugin adds one only when a noindex source,
the theme's robots value, a legacy record's robots value or entry directives
give it a value; with none of them neither the plugin nor EmDash core adds a
robots tag. While robots output is paused, the plugin keeps its restrictions
readable in one or more separately keyed robots tags
(`shipit-seo:robots:restrictions:v1`, with a numeric suffix for each further
distinct value or a key already in use) beside any core or other plugin robots
tag.

The other surfaces follow the rule without changing stored data. The
IndexNow content types list keeps every public type and its saved choice;
a ruled type is marked "Noindex rule", never counts as submittable, and
Start automatic submission refuses a selection of only ruled types. Manual
IndexNow submission leaves out each URL whose address matches the URL
pattern of a ruled type, in any routed locale, reports those URLs in the
result and names the ruled types with their patterns in the dialog.
Matching is by address shape, so a pattern made only of placeholders,
such as `/{slug}`, also covers other pages of that shape. While the rule
or the content types cannot be read, nothing is withheld. Internal link
suggestions treat a target of a ruled type as noindex and count it under
"Excluded from search", as the sitemap leaves it out. Settings search
finds "Content type noindex rules" on Indexing rules. Restore inherited
states that the content type and taxonomy archive rules are kept.
Files: `admin-contract.ts`, `content-type-noindex-policy.ts`,
`content-type-noindex-routes.ts`, `content-type-indexing.ts`,
`settings-state.ts`, `settings-runtime.ts`, `sandbox-entry.ts`,
`indexnow-runtime.ts`, `entry-analysis-runtime.ts`, `analysis.ts`,
`score-lifecycle.ts`, `sitemap-engine.ts`, `sitemap-runtime.ts`,
`portability.ts`, `registry-panel.ts`, `internal-link-host-ports.ts`,
`internal-link-native-target.ts`, `AU/contract.ts`, `AU/admin.tsx`,
`AU/content-type-indexing-controls.tsx`, `AU/content-type-indexing-container.tsx`,
`AU/taxonomy-indexing-controls.tsx`, `AU/taxonomy-indexing-container.tsx`,
`AU/indexing-rules-model.ts`, `AU/indexing-rule-status.tsx`,
`AU/indexing-settings.css`, `AU/taxonomy-indexing-controls.css`, `AU/sitemap-view.tsx`,
`AU/content-extensions.tsx`, `AU/content-extension-model.ts`,
`AU/editor-basic-analysis.ts`, `AU/indexnow-view.tsx`,
`AU/indexnow-view-model.ts`, `AU/workspace-model.ts`, i18n.
Browser checks: the list matches the Sitemaps page; choosing Noindex for
Posts shows "After saving: Noindex (Content type rule)" while the saved
state still reads Index, and saving renders `noindex,nofollow` on a post,
removes `sitemap-posts.xml` from the index and shows the inherited state
in the post editor; choosing Index again restores both; site-wide Noindex
makes the type and archive rows read-only with their kept rules, and site-wide
Index shows them again unchanged; a removed type stays listed by name
until removed; the export lists the same names.

**I3. Redirects & 404s.** Tabs read Redirect rules, 404 activity,
Forwarded paths, with Redirect rules selected on entry; at narrow widths
the tabs wrap instead of scrolling out of view. Save redirect and Save
changes are primary. Each 404 activity
row (Recorded paths and Top by hits) offers Create redirect, which opens
Redirect rules and the existing New redirect dialog with Source set to
that path. An unresolved earlier save is opened for review instead of
being replaced; validation and save are unchanged.

**I4. Narrow widths.** Crawl diagnostics rows and Forwarded paths rows
carry `shipit-seo-mobile-meta` with the hidden columns' key values and the
row action. Tables with mobile meta drop the fixed 900px minimum width
(`shipit-seo-table-wrap--fluid`). The sitemap explorer keeps Address and Status
columns until the workspace is 420px wide; below 720px the modification date
moves below the address, and below 420px the status joins it.

**I5. IndexNow.** Turn off IndexNow opens a destructive confirmation that
queued URLs stop being sent; Cancel keeps it on. The saves read "Save
content types" and "Save advanced settings". The header says
"Participating engines such as Bing receive these URLs. Google Search is
not an IndexNow participant." Both saves and Start automatic submission are
primary.

**I6. llms.txt.** The output switch moves to the main panel header with
"Applies immediately. Text changes need Save."; the aside keeps the public
file facts and the check. The switch label names the saved state it shows,
Output on (saved setting) or Output off (saved setting), and Save is
primary.

**I7. Sitemaps.** "Sitemap index: <link>" shows above the Content types
fieldset, and each listed type shows its file links from the plan. A type's
count reads "1 file from 16 published entries" and a note under the list
says that counts include every published entry while a file leaves out
noindex entries, excluded paths and entries whose canonical points
elsewhere, so the count is never read as the number of listed URLs; the
plan counts rows without evaluating each entry. An address breaks after a
slash first, and a link's icon stays beside its text.

**I8. Robots.txt.** A help line under the editor: "EmDash Settings > SEO
edits the same robots.txt text." with a link to `/_emdash/admin/settings/seo`.
Restore default is disabled while nothing is stored, also when the editor
holds only an unsaved draft; Discard changes clears that draft without a
write.

## Checks

Selfchecks cover the policy, storage, save merge, portability, analysis
input identity, sitemap listing, analyzer text, editor state, the step
model, IndexNow scope and manual withholding, address matching, link
target noindex, settings search, the Indexing rules status model and each
view change. Of the taxonomy
archive, indexing defaults, sitemap and robots published-host smokes, only
the taxonomy archive smoke builds and serves a site and reads robots meta
and sitemap responses over HTTP; it also renders an entry of a ruled type
with `noindex,nofollow`, checks that its type leaves the sitemap index and
its child file answers 404, and that removing the rule restores both. The
others run below HTTP on a migrated SQLite
database: the indexing defaults smoke calls the `page:metadata` hook with a
host-created plugin context, the sitemap smoke calls the sitemap runtime
functions (`buildSitemapAdmin`, `serveSitemapFile`), and the robots smoke
calls EmDash's settings and `/robots.txt` route handlers directly. Outside
these four, the packed consumer check (`packed-single-seo.mjs`) also serves
pages and the sitemap over HTTP.

## Documentation impact

The README Site-wide indexing, Content type indexing and Taxonomy
archive indexing sections, its translation scope paragraph and the
0.4.0-beta.48 CHANGELOG entry now describe the content type rule, its
precedence and limitation, and the Index or Noindex choices and saved,
pending and unconfirmed states of Indexing rules. Customer documentation
(README, UPGRADE, CHANGELOG, INSTALL-PROMPT) still needs the Local SEO
steps and Website card, the redirect action, the IndexNow confirmation
and engine note, and the llms.txt switch. That pass belongs to the later
documentation change for this release. Architecture and permissions are
unchanged; the settings storage version is unchanged.


## Bounded sitemap and crawl review

Sitemap file boundaries remain the public XML engine's boundaries. The admin
explorer has independent 25/50-row table pages. Search and Listed/Left out
filters apply only to the selected file. Counts distinguish candidates in a
content type, decisions in the selected file, and matches in its table.
Continuation cursors bind that file's full decision snapshot, effective
settings and routing, and the filters; a changed snapshot is refused without
silently moving the user's position. No generic full-site text search is
implied. The explorer aligns its file choices and filters in one toolbar,
shows file navigation only when there is more than one file, and shows row
navigation only when the displayed response has another page. Rows per page
and the snapshot-bound row summary sit together below the results. Search
submission, cursor reset, stale-result labels and permission-loss behavior
remain unchanged.

Opening Content graph performs no content analysis. Analyze sample runs one
bounded read: at most 1,000 records across content types, 20,000 retained
editor links, 5,000 traversal nodes per document and 100,000 traversal nodes
overall. Findings retain at most 250 rows per type. Summary totals cover
observed findings in that sample; omitted rows and incomplete coverage remain
visible. Search, content-type filters and 25-row pages operate on retained
results. A failed rerun must not display the earlier result as current.

Public XML inclusion, metadata ownership, revision guards and feature
activation do not change. No background crawl, paid provider request or
collection-wide hydration is introduced to decorate the settings screen.
