# Local SEO and Indexing

Local SEO owns the business identity flow. Indexing tools own search-visibility
rules, sitemap configuration, robots.txt, llms.txt, IndexNow and diagnostics.
Their save scopes stay separate; opening a page does not start a scan or
provider submission.

Source references below are relative to `packages/emdash-plugin-seo/src/`;
`admin-ui/` contains the views and client models.

## Business identity

Local SEO has six numbered steps from Identity to Review and save. Completion
markers use the same client validation as the review, together with field
errors from a refused write.

Identity includes a Website summary with the saved name and production URL.
It reports an unsaved Website draft and links to Edit website. Website has a
separate save and a Back to business identity action; moving between them
preserves the identity draft.

Steps 1 to 5 offer Previous, Discard changes and Next. Review offers the save
action and a Status and entity section for turn-on, turn-off and entity
transitions. Those transitions retain their confirmations and revision guards.
Enter in a field opens Review before any write.

The logo field recommends a square image of at least 112 x 112 px. Choosing
Person hides organization-only fields, including legal name, logo, countries
served, address, service area, location, hours and price range. The draft
retains those values for a later kind change; a Person request omits them.

Each field has one editing owner:

| Data | Owner |
| --- | --- |
| Website name and production URL | Website settings |
| Publisher name, logo, profiles and address | Business identity |
| Default sharing image and X attribution | Search & social |

Legacy publisher values in Website settings remain stored and feed setup
prefill and fallback output. The interface does not merge or delete them.

Owners: `admin-ui/business-identity-view.tsx` and the identity and Website
containers in `admin-ui/admin.tsx`.

## Indexing rules

The page lists Site-wide, Content types and Taxonomy archives, followed by
collapsed help, recovery notices and the action bar. Every choice is an
explicit Index / Noindex radio group, named for the affected site, type or
archive. Content types includes custom public types from the sitemap
configuration read; Edit in Sitemaps is a section action.

Rows distinguish saved effective state from pending changes:

- The saved state names its source: Site-wide rule, Content type rule or
  Archive rule.
- A draft that changes the result adds After saving and an Unsaved marker.
- An unknown save outcome uses Save not confirmed until readback resolves it.
- A site-wide Noindex draft makes subordinate controls read-only and shows
  Own rule kept. The type and archive lists are preserved.

The effective restriction is site-wide noindex first, then a content type
rule, then the entry's own noindex. Each can add noindex; an entry cannot
override a broader restriction. Index on a content type is permission to
index, not a guarantee that every entry is indexable.

Taxonomy rules apply only to archive templates using this plugin's archive
integration. They do not add noindex to entries assigned those terms.
Robots.txt is configured separately. The page does not claim this plugin
serves the sitemap until the ownership read succeeds.

Owners: `admin-ui/indexing-rules-model.ts`,
`admin-ui/indexing-rule-status.tsx` and the content type and taxonomy
indexing controls and containers.

## Content type rule storage

`contentTypeNoindex?: string[]` belongs to `settings:global:v1`, storage
version 1. Like `taxonomyArchiveNoindex`, it is optional and presence-aware.
It contains sorted, unique exact collection keys, at most 100, matching
`^[a-z][a-z0-9_-]{0,63}$`. A malformed stored value makes the record corrupt;
it is not guessed or silently repaired.

Saves retain the settings revision guard. A draft tracks only its added and
removed names through `rebaseIndexingNameLists`. A newer read or a save from
another settings page rebases those changes on the latest list, preserving
names this editor did not edit. Newly added names must identify current
content types. Names of removed types remain visible and can be removed.

A client that omits the field keeps the stored list. Restore inherited also
keeps it. Export includes it when present; importing a bundle without it
preserves the current list. Importing newly restricted types is a destructive
change and requires its warning.

Owners: `admin-contract.ts`, `settings-state.ts`, `settings-runtime.ts`,
`content-type-noindex-policy.ts` and `portability.ts`.

## Output and dependent features

Entries of a restricted type emit `noindex,nofollow`. Their type is absent
from the sitemap index and its child file returns 404. The stored sitemap
choice remains available and is labelled Noindex rule. The editor names the
inherited restriction and links to Indexing rules. A changed rule makes
affected saved analyses stale without changing the input identity of other
types.

With active robots output, the plugin's tag precedes the host's, and the
host keeps the first robots value. The plugin adds a value only for a
noindex source, theme robots, legacy robots or entry directives. With none,
neither it nor EmDash core adds a robots tag. When coexistence pauses robots
output, restrictions remain in separately keyed tags
(`shipit-seo:robots:restrictions:v1` and numeric suffixes as needed) beside
any host or other-plugin tag.

Automatic IndexNow skips restricted types while retaining their saved
choices. A selection consisting only of restricted types cannot start
automatic submission. Manual submission excludes matching URL patterns in
routed locales and reports the omitted URLs and types. This is address-shape
matching: a pattern such as `/{slug}` can cover other pages with that shape.
If rules or content types cannot be read, this filtering withholds nothing.

Internal-link suggestions treat restricted targets as excluded from search.
The analyzer also names the content type rule as the restriction's source.

Owners: `sitemap-engine.ts`, `sitemap-runtime.ts`, `indexnow-runtime.ts`,
`content-type-noindex-routes.ts`, `entry-analysis-runtime.ts`,
`score-lifecycle.ts` and the native internal-link target modules.

## Sitemap explorer

The sitemap page links the index and each content type's files. Plan counts
include all published candidates before per-entry exclusions are evaluated;
they are not counts of listed URLs. Public files omit noindex entries,
excluded paths and entries with a canonical pointing elsewhere.

The explorer uses the public engine's file boundaries, with independent
25- or 50-row table pages. Search and Listed / Left out filters apply only
to the selected file. Counts distinguish content type candidates, decisions
in that file and matching table rows.

Continuation cursors bind the full file decision snapshot, effective settings,
routing and filters. A changed snapshot is refused rather than moving the
reader to a different position. This is not full-site text search.

File navigation appears only for multiple files; row navigation appears only
when another result page exists. Search submission, filter changes and cursor
reset must keep stale results and permission loss explicit. Below a 720px
workspace width the date moves under the address; below 420px status joins it.

## Diagnostics

Opening Content graph performs no analysis. Analyze sample runs a bounded
read with these limits, defined in `crawl-diagnostics.ts`:

| Resource | Maximum |
| --- | ---: |
| Records across content types | 1,000 |
| Retained editor links | 20,000 |
| Traversal nodes per document | 5,000 |
| Traversal nodes overall | 100,000 |
| Retained findings per type | 250 |

Summary totals describe observed findings in that sample. Incomplete coverage
and omitted rows remain visible; an empty result is not a full-site clean
bill. Search, type filters and 25-row pages operate on retained results.
A failed rerun must not present an earlier result as current.

The rendered crawl is a separately started diagnostic. Neither view creates
a background crawl or a paid provider request merely by opening the page.

## Other Indexing tools

**Redirects & 404s.** Redirect rules, 404 activity and Forwarded paths are
separate tabs. Create redirect on a recorded path opens the existing dialog
with Source filled in. An unresolved earlier save opens for review instead
of being replaced.

**IndexNow.** Turning it off requires confirmation because queued URLs stop
being sent. Save content types and Save advanced settings have separate
scopes. Provider copy identifies participating engines such as Bing and
states that Google Search does not participate. Provider acceptance is not
inferred from local queue or configuration results.

**llms.txt.** The output switch applies immediately and identifies its saved
state; text edits require Save. Public file facts and the check remain
separate from the editor.

**Robots.txt.** EmDash Settings > SEO edits the same text. Restore default
requires a stored value; Discard changes clears a draft without writing.

Tool tabs wrap at narrow widths. Crawl and forwarded-path tables move
important values and actions into mobile row metadata instead of forcing a
wide table.

## Maintainer checks

Cover saved, pending and uncertain indexing states; site-wide override and
restoration of retained rules; concurrent edits; removed types; export and
import; sitemap exclusion; and inherited editor output. Check Local SEO kind
changes, separate Website saves and review transitions without losing drafts.

Use HTTP output checks for public robots meta, sitemap indexes and child
files. Tests that call handlers or engine functions directly do not establish
the served result. Also exercise snapshot changes during pagination, bounded
diagnostic coverage, failed reruns, keyboard use and narrow layouts.

See [workspace saves and navigation](admin-navigation-contract.md) and
[current platform coverage](compatibility.md).
