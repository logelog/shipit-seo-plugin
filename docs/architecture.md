# Architecture

Shipit SEO keeps one shared domain engine and a native adapter. The admin uses EmDash's existing React, Kumo
and query dependencies rather than installing a separate admin application.

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`; its preview is
`http://127.0.0.1:4365/_emdash/admin`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

[compatibility.json](../compatibility.json) supplies target selection and pins
to the development toolkit and host environment. See
[compatibility.md](compatibility.md) for upgrades and evidence boundaries.

## Code map

Paths below are relative to `packages/emdash-plugin-seo/`.

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin registration, hooks and settings integration |
| `src/astro.ts` | Native Astro integration around the site's existing EmDash call |
| `src/branding.ts`, `src/branding-files.ts` | Branding rules shared by every bundle, and the build-time logo checks |
| `src/legacy-brand-text.ts` | Earlier stored wording that the admin cleans when it shows saved analysis rows |
| `src/admin-contract.ts` | Shared admin request and response contracts |
| `src/analysis.ts` | Content assessments, check policy, score limits and the score display decision |
| `src/check-presentation.ts` | Checklist groups, row words, order, counts and earlier-analyzer handling for every surface |
| `src/snippet-metrics.ts` | Search preview widths and font metrics shared by the previews and snippet fit rows |
| `src/admin-ui` | Workspace and content-editor interfaces |
| `src/admin-ui/i18n` | Bundled message catalogues and admin-locale fallback |
| `scripts/packed-artifact.mjs` | Customer archive boundaries, link checks and the brand-neutral text check |

Read the relevant nearby selfchecks before changing a contract. Engine and
admin checks live next to their source. Real-host tests under
`scripts/published-host` use the selected published dependency graph.

## Data and effects

Keep website defaults, publisher identity, content-type templates and individual
entry overrides distinct. A navigation change must not save a form, discard a
draft or enable optional work. Preserve revision checks and unknown-save recovery
when changing settings or schema forms. A workspace page whose form holds
unsaved work stays mounted, hidden, until the work is saved or discarded, so
moving between pages keeps the draft and the revision it started from
(`admin-navigation-contract.md` N11). Feature controls writes its module record
only through a compare-and-set on the revision the page loaded; a host without
conditional storage cannot save it.

Branding is a build-time fact (`white-label-contract.md`). The Astro adapter
validates the third `shipitSeo()` argument and records it in the installation
options; the descriptor and the native runtime set the admin page label from
it, and the admin reads that label back from the host manifest it already
caches. The only runtime read is the logo descriptor route `admin-branding`.
An unreadable record shows the neutral name `SEO` and never stops public
metadata. Stored analysis text is never rewritten; `check-presentation.ts`
cleans earlier wording when a row is shown.

EmDash 1.3 still renders the admin page of a disabled plugin. While the admin
manifest EmDash already loaded marks Shipit SEO disabled, the page shows only
the disabled notice and sends no plugin request. A plugin request answered with
EmDash's route-not-found 404 asks EmDash to read the manifest again once and
shows the same notice unless the manifest says the plugin is enabled
(`plugin-availability-model.ts`).

Focus keywords, basic browser checks and previews work with optional server
analysis off. Basic checks use the saved snapshot already loaded for the editor
and local keyword changes, not unsaved body edits. Their module settings come
from that entry preview. They do not write a server score or history. Opening
the editor or typing a keyword must not admit manual server analysis.

**Analyze this entry** admits one privileged request for the exact saved entry
and locale. It requires an explicitly saved assessment profile and preserves
input, policy revision and conditional-write checks. With automatic analysis
paused or awaiting confirmation, it updates only the current score: no history
append, pruning or history lease. It neither chooses a profile nor acknowledges
resource use. Stored-only freshness and identity reads remain read-only. The
editor makes one such freshness read when it loads a stored result for the
saved version and its saved keywords, and shows that result only once the read
confirms it. The overview route reads no entries: its content rows are saved
numbered results of the current analyzer under the current settings. Content
health then sends one stored-only freshness request for each overview snapshot
and selection of rows, for at most 11 refs (the first 10 rows of the selected
type and a linked entry), about 51 statements and 2 entry reads per row, with
no analysis or writes (`contentHealthScoreCell` and
`contentHealthFreshnessRefs` in `admin-ui/overview-model.ts`). A type change
sends another request only when it selects different rows; a return to an
earlier type sends one again, because a check is not kept once the view stops
using it. Opening the view checks again, and a failed request is not retried
automatically. A band shows only for a row that a successful request, sent
since the view opened, found current; while a request runs or after one fails,
every row keeps its saved number in grey.

Automatic hooks, score history and filtered bulk scans retain the optional
analysis activation and resource-use notice. Scans also require an explicit
**Start analysis** action; activation starts no catch-up work. Existing scores
become stale when their inputs change; do not add continuous scans to keep them
current. The analyzer version and `SEO_ENGINE_VERSION` are part of that input
identity, so a new analyzer or package version re-analyzes each entry once on
its next automatic check, scan or manual analysis. A scan job records the
analyzer that started or last resumed it and pauses once for a policy change
when another analyzer continues it. Analysis
and IndexNow submissions keep separate controls. Opening an admin page or
disclosure must not acknowledge resource use or send provider requests.
Synthetic transports in local tests do not prove live provider acceptance.

Taxonomy archive rules share the Indexing settings record and revision guard.
Archive templates bind a resolved taxonomy with `taxonomyArchivePage` before
passing the custom context to `EmDashHead`. This adds no public taxonomy lookup
and changes no assigned entry, content sitemap or saved-post score identity.
The cached admin list reads definitions only. The SDK materializes the full
list before the 200-item response cap; do not describe that cap as a database
read limit. Unavailable or deleted saved choices remain explicit until removed.

Content type rules (`contentTypeNoindex`) share the same record and revision
guard. They are read from the one settings snapshot each consumer already
takes: `resolveEffectiveContentMetadata` adds a `content-type-rule` noindex
source, so page metadata, previews, the analyzer, crawl and hreflang agree;
the sitemap leaves a ruled type out of its index without rewriting the stored
sitemap choice; automatic IndexNow skips it, manual IndexNow submission leaves
out URLs that match a ruled type's URL pattern, and internal link targets of a
ruled type count as noindex. Only a rule that names the
entry's collection enters its saved-analysis identity, so other types keep
their scores current. A rule only adds noindex and never lifts an entry's own
noindex or the site-wide one.

Each noindex source renders one robots directive in `page:metadata`, and these
stay unchanged unless a contract says otherwise. Site-wide noindex and a
content type rule emit `noindex,nofollow`. A taxonomy archive rule adds
`noindex` to the theme's directives without `nofollow` and drops `index`; when
the site-wide rule applies to that archive too, it adds `noindex,nofollow`
there and drops a positive `follow`. On content entries the entry's own core
noindex and a legacy record whose robots contain noindex also emit
`noindex,nofollow`, as before. A theme's own `page.seo.robots` that already
contains noindex is not a Shipit source: on a page no Shipit source covers it
is kept, normalized to lowercase comma-separated tokens like every robots value
(`mergeRobotsDirectives`), instead of being replaced with `noindex,nofollow`
(`resolveEffectivePageMetadata` in `src/sandbox-entry.ts`; before
`0.4.0-beta.45` it was replaced). Entry directives from Advanced are merged
after the source's directive. On a stored content entry with no Shipit noindex
source and no legacy robots value, the theme's `page.seo.robots` is that base,
so the directives extend it instead of replacing it and a theme noindex stays
(before `0.4.0-beta.48` they replaced it). The host keeps the first robots tag
and the plugin's comes first, so an empty base would drop the theme value. A
legacy record's own robots value still replaces the theme value. Unless plugin
coexistence pauses the plugin's robots output, a page therefore carries at
most one robots tag in EmDash's head output, and neither the plugin nor
EmDash core adds one when no noindex source, theme value, legacy robots value
or entry directive gives it a value. While robots output is paused, the plugin
keeps its restrictions readable in one or more separately keyed robots tags
(`shipit-seo:robots:restrictions:v1`, with a numeric suffix for each further
distinct value or a key already in use) beside any core or other plugin robots
tag.
`src/head-robots.selfcheck.ts` runs each source through the real hook, for
retired and stored entries.

Sharing tags and structured data resolve site paths against the production
URL saved in Website settings, or the host's site address when none is saved
(`getGlobalSettings`). EmDash overlays an entry's stored SEO image and
canonical onto the page context made absolute on its own site address
(`applySeoPanelToPageContext`). Where og:image is that stored image,
`withEntrySeoImage` in `src/sandbox-entry.ts` hands the schema builders
og:image's URL instead, so both name one address and the chosen image is
unchanged. Entry structured-data IDs follow `page.canonical` or `page.url` as
the host passes them, so a site-relative stored canonical puts them on the
host's site address while the canonical link uses the Website URL.

## Native SEO authoring

The General popup edits native SEO title and description; Social can choose,
replace or clear the native custom image. These use the published native 1.3
content APIs and media picker. The native SEO panel remains available. Canonical
and indexing edits stay in that panel; the popup creates no parallel General
override. Fields shadowed by legacy data remain with their current owner.

**Save SEO fields** sends only changed native fields with the observed entry
revision and locale, then confirms them through readback. It preserves body
content, canonical, noindex and unrelated fields. A pending image clear
previews the featured-image or site fallback it reveals, marked unsaved; it
neither deletes the asset nor suppresses all sharing images. Social title and
description retain their separate explicit save and conflict checks; the two
saves are not atomic.

The popup cannot synchronize an unsaved host draft or its private write token.
Save other post changes before SEO. A newer saved entry the host passes to the
panel, such as an autosave, keeps the popup and its draft mounted: identity is
collection, entry id and locale. When its native SEO fields equal the draft's
baseline it becomes the guard for the next write; otherwise the saved values
open the existing review. Native 1.3 keeps the form on a revision
conflict: after an SEO save over unsaved post edits, the host's next save of
the post, autosave or manual, shows its own conflict banner ("This entry
changed somewhere else after you opened it.", action Save anyway). A deliberate
**Save anyway** resubmits the form content without SEO fields, so it keeps the
post text and the saved SEO values; reloading the page discards the unsaved
post text. The
popup cannot remove this host limitation.
An uncertain popup write keeps the edits for readback and review, without an
automatic retry or reload. A host 409 with code `ENTRY_LOCKED`, another editor
holding the entry, is refused before any write and is not a revision conflict:
the draft is kept and no review opens (`classifyNativeSeoWriteError`).
While a review is open, the search card shows the reviewed saved title and
description, not the last loaded host entry, for each field whose current
preview ownership facts show no earlier SEO record; the sharing card keeps the
last loaded preview.

The panel refreshes EmDash's saved entry through the host's public query cache
(`["content", collection, id]`), never its private write token, and only once
per saved version: after a confirmed save or an adopted read while the host
entry is older than the adopted revision, and when the preview's saved-content
read reports a newer version than the entry EmDash passed, which happens when
EmDash shows its cached entry on reopening within its 60 second cache time.
A host entry that changes brings the panel a new saved version, whose preview
loads on its own; one that stays the same is followed by one preview read.
The preview binds itself to a version by reading the saved entry before and
after its request, so each saved version costs one host read and these two
reads. **Retry preview** and **Retry checks** always send a request.

## Assessment presentation

`analysis.ts` is the one scoring engine and `check-presentation.ts` the one
presentation module. Browser checks, **Analyze this entry**, scans, the content
list, overview, history and the sandbox panel use both; no surface computes its
own number, row word or count.

Analyzer 22 lists each check's role, weight, severity and allowed outcomes in
one policy table, per profile where Article and General content differ. The
engine coerces other outcomes and the validator refuses them. Partly met earns
35% of a weight; unavailable and not-applicable rows carry none. Score limits
derive only from evaluated rows: missing title 49, Article body text under 50
words 40 and from 50 to 599 words 70, failed repetition 79, and a primary keyword
missing from title, description and body text 79. The calculation keeps the raw
score, the lowest limit and every applicable limit. Status and grade follow the
band of the limited score (80 and 50). Article body length passes at 600 words,
is partly met from 300 to 599 and fails below 300; explicit General content
keeps its short-page policy. A known body under 100 words makes keyword
repetition not applicable. Larger samples retain the literal-phrase test above
3.5% with at least three occurrences, with factual count/ratio feedback.

Browser checks run automatically without a configured profile or optional
server analysis. A saved assessment profile takes priority; otherwise the exact
built-in collection key `posts` uses Article and Pages and custom collections
use General content. The header names these default checks; Analysis options
offers an optional override. This fallback is not persisted, does not start
server analysis and does not depend on schema output. A default browser result
takes priority over stored or session results so an older General score cannot
mask the Article checks on a post.

`seoScoreDisplay` is the display decision: a number and band, or a dash with **Partially checked** when a weighted row or the body text
was not read, or
**Too little text to score** for General content under 50 words. Dashed results
get no comparison context, stay out of overview samples, averages and trend
points, and keep an `unscored` reason in history.

`presentSeoChecks` assigns groups, row words, order and counts. Issues are
Failed and Partly met rows; header totals are the sums of the group counts, and
needs-attention counts use issues only. Not-applicable rows collapse by reason.
A set focus keyword hides its own row; the indexing directive is a condition
shown apart from the score, never a row. Thresholds are Shipit guidance, and
snippet fit is an estimate, never a character limit.

Browser checks read image alt, nosnippet and generated-description settings
from the entry preview's `analysis` block, which the server resolves with the
same module and override reads as its analysis. A preview without that block,
from an older server, falls back to the editor's own feature read. Server
analysis and browser checks pass the publication date the preview shows before
the description as `descriptionPrefix`, from `seoSnippetDatePrefix` in the
entry locale, so Description fit, the field estimate and the preview cut the
description at the same word. The server reads the default `content` field
before any custom body field, so browser checks withdraw body image and
secondary keyword evidence only when the saved data has no `content` field.

A result whose `scoreVersion` differs from `SEO_SCORE_VERSION` is an earlier
result. Its rows are never classified through the current policy, which throws
on their weights, and every surface shows **Earlier analyzer** without a number,
band, meter or comparison. Adding, removing or reordering a scored check ID
needs a new comparison policy; changing a weight, limit, threshold or snippet
metric needs a new `SEO_SCORE_VERSION`. Analyzer 21 results and history remain
readable without current numbers or comparisons. A scan crossing the analyzer
change pauses for a policy review; an upgrade does not reanalyze entries or
activate optional analysis or providers.

## Schema and preview presentation

Additional schemas remain additive. The overlap notice uses emitted saved
graphs and excludes only the custom record being edited, retaining other custom
graphs. The form validates JSON-LD with the bounded shared parser and checks
top-level and `@graph` types even when the guided editor cannot preserve the
shape. Nested author or address entities do not count as another top-level graph.
The notice does not inspect theme or other plugin output. Its read-only native
disclosure opens and receives focus without saving, closing or resetting a draft.

The entry Schema tab leads with Schema in use: the entry's own records, which
alone can be edited or removed (with an inline confirmation), then every other
graph the Shipit SEO preview adds, each with a source badge (This entry, Content
type default, Shared, Site). The list predicts Shipit's output for the confirmed
saved entry and is never presented as observed public HTML. Per-entry default
switches sit in one collapsed disclosure. The Schema library is a tab of the
Schema workspace: `?view=library` stays its deep link and shares the retained
Schema owner, and Use template opens an independent copy in the builder under
`?view=schema`. See `schema-authoring-contract.md`.

The full search preview keeps its fixed device canvas and original font sizes.
A narrower container provides a labeled, keyboard-focusable horizontal scroll
region around that canvas. Metadata and modal controls remain outside it.
Preview fitting and the analyzer's snippet fit rows share the widths and font
metrics in `snippet-metrics.ts`, so a row names the cut point the preview shows.
The preview's publication date before a description takes part of that line
budget; the fit rows and the popup's live field estimate measure the
description alone. The compact sidebar keeps natural text flow; full
metadata, source labels, character counts and the separate Social draft/save
flow stay unchanged.

## Development and release output

The local fixture owns ignored database, session and cache state under `.dev`.
Do not copy those files between contributors or into a package. Admin HMR uses
source TSX/CSS with a one-time runtime refresh; final verification rebuilds the
package with declarations before running type and consumer checks.

The customer archive is controlled by the package's explicit `files` list and
packed-artifact checks. It contains runtime code, styles, declarations and
customer documentation, without contributor tests, fixture routes, source maps
or local state. Published JavaScript is inspectable; packaging is a distribution
boundary, not source-code secrecy.

## Adding features

Keep changes focused and state their observable behavior, data ownership,
permissions, resource use and recovery path. Add a meaningful regression test
and update affected customer guidance. Native Node/SQLite results do not imply
Cloudflare/D1, Postgres or sandbox support. A new host target needs its own
pinned graph and acceptance evidence.
