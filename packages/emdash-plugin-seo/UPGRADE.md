# Upgrade Shipit SEO safely

This guide covers the `0.4.0-beta.54` beta release for native EmDash and
admin 1.3.0 or 1.3.1 on Node with SQLite. Its target host uses Node 24.19.0 and Astro
7.3.2. Earlier 0.4.0 betas were pre-release candidates and were not published;
the sections for them below apply to a site that installed one of those
candidates from an archive. Cloudflare Workers/D1, Postgres and
sandbox/registry installations remain outside this beta's verified scope. Live
IndexNow provider delivery is also not verified.

## Choose a version

Read the target version's [changelog](CHANGELOG.md), compatibility requirements
and migration notes before updating. Beta releases can change behavior or data
formats; a higher version does not establish that a downgrade will be safe.
A tested update path does not cover every older version.

The `beta` channel is a moving label, not a durable version pin. Review the
resolved version, then save that exact version in the manifest and retain the
existing lockfile. Nothing updates Shipit or your host automatically. EmDash's
plugins manager shows the installed version and can enable or disable the
plugin, but it cannot install, update or uninstall a plugin added with a package
manager.

## Update in five steps

1. Back up: confirm pending saves, stop every writer, and take a consistent
   database and uploads backup together with the current manifest, lockfile and
   configuration ([Prepare and rehearse](#prepare-and-rehearse)).
2. Install the exact new version with the package manager the site already
   uses, saved exactly, and keep the `shipit-seo` plugin ID, the integration
   options and the existing lockfile
   ([Update the dependency](#update-the-dependency)).
3. Run the site's checks and production build.
4. Restart or deploy the site the way it is normally deployed, then check the
   points in [Verify before reopening the site](#verify-before-reopening-the-site).
5. If anything is wrong, stop the writers again and follow
   [Recover a failed update](#recover-a-failed-update): restore the previous
   manifest, lockfile and configuration, and the matching backup when stored
   data changed.

Try these steps on an isolated copy of the site first.

## Tested update paths

The following historical pnpm checks cover the named version pairs and exact
local archives. Results for one archive do not establish acceptance of a later
version or a changed archive:

- From `0.4.0-beta.49` to `0.4.0-beta.50` on native EmDash and admin
  1.3.1, Node 24.19.0 and SQLite, using exact local archives. All installed
  package files were compared, and the stopped database, uploads and sessions
  stayed unchanged through installation and a production build.

The earlier beta was also tested from `0.4.0-beta.39` to
`0.4.0-beta.49` on EmDash 1.3.0. That does not establish a direct update
from beta.39 to the current version.

The pnpm removal and reinstallation evidence also covers beta.50. These checks
do not qualify a different target archive. Updating, removing or reinstalling
the package with npm is not verified; on an npm
site, rehearse each step on an isolated copy and review the lockfile diff
before changing the real site. Other earlier versions follow the notes for
their version below without a tested path of their own. Moving from the
earlier `@shipit`-scoped alpha packages to this package is untested and
unsupported in this release.

## Prepare and rehearse

Use an isolated copy of the site first. Record the old and new plugin versions,
EmDash/admin/runtime versions, package manager, configuration and lockfile.
Keep the `shipit-seo` plugin ID, storage, existing integration options and
activation state. Do not uninstall the plugin as an upgrade step or upgrade
EmDash to resolve an unreviewed compatibility mismatch.

Confirm pending saves and reconcile conflicts or unknown outcomes. Pause scans
and optional automatic analysis; turn IndexNow delivery and automatic submission
off through their controls. Record which settings were changed for the rehearsal.
Closing a panel does not prove server work stopped. Already accepted provider
requests cannot be undone by an update.

Gracefully stop every application instance, worker and scheduler before replacing
dependencies. Take a consistent database/uploads backup with its matching
manifest, lockfile and configuration, and verify restoration on a copy. Use a
SQLite-aware backup that preserves committed WAL data; copying only the main
database file can omit saved changes even after writers stop. A configuration
export is not a complete backup. If the site installed Shipit SEO from an
archive file, keep that archive with the backup: the lockfile refers to it.

## Update the dependency

Use the site's existing package manager. For a pnpm site:

```sh
pnpm add --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.54
```

For an npm site, use this command instead. An update with npm is not verified
for this release; see [Tested update paths](#tested-update-paths).

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.54
```

Keep one lockfile and review the dependency diff. Retain the existing Astro
wrapper, host adapter, database, collections, locales, other plugins and public
routes. If the installation predates the wrapper, follow the specific transition
in [INSTALL-PROMPT.md](INSTALL-PROMPT.md), preserving its options and stored data.
A site still on the earlier `@shipit`-scoped alpha packages has no tested or
supported path to this release. Before trying it, take a consistent backup,
restore it to an isolated copy and make the change there first.
Run the site's checks and production build, then restart the isolated copy.

## Branding is kept

A name and logo set with `branding` live in the site's `astro.config.mjs` and
`public/` directory, not in the database or the package. An update keeps them
and needs no change; the next build checks them again with the same rules. See
[Use your own name and logo](README.md#use-your-own-name-and-logo).

## Verify before reopening the site

- Confirm the exact installed version in the installed package's `package.json`
  and in EmDash's plugins manager, and the intended active or inactive state
  there. Do not take the version from EmDash's internal plugin tables: EmDash
  1.3 can keep an earlier version number there after an update or rollback.
- Check a saved entry's focus keywords, checklist and readable search/social
  previews with optional automatic analysis still off. Stored scores can become
  stale; retained history is not a fresh analysis.
- Check saved native SEO fields, schemas, social image inheritance and existing
  settings. Native SEO and schema saves are separate from the content draft and
  can affect an already published page immediately.
- Inspect anonymous public HTML for the actual theme title, description,
  canonical, robots, sharing metadata and JSON-LD. A saved preview is approximate
  and does not verify a live page.
- Check relevant sitemap, robots.txt, llms.txt, redirects and explicitly connected
  taxonomy archives. Preserve restrictions; archive rules do not change assigned
  posts. Review cache invalidation through the site's established process.
- Confirm Indexing rules shows the intended site-wide, content type and
  taxonomy archive rules. The update adds no content type rule; a rule stored
  by `0.4.0-beta.42` or later, for example before a rollback, applies again.
- Confirm the update did not activate automatic analysis, start a scan or submit URLs.
  Resume optional work only after reviewing retained settings and queues.

Keep content, uploads, core SEO, settings, schemas, library templates, analysis
profiles, scores/history, migration records and IndexNow keys/queues/history.
An upgrade does not authorize deletion, reimport or resetting stored data.

## Score analyzer 22

Versions from `0.4.0-beta.53` use analyzer 22; beta.41 through beta.52 used analyzer 21.
Article body text now passes at 600 words, is partly met from 300 to 599 and
fails below 300. Article scores are limited to 40 below 50 words and 70 from
50 to 599. Explicit General content keeps its short-page policy. A known body
under 100 words has no keyword repetition score because the sample is too
small. These thresholds are Shipit guidance, not search-engine requirements.

From beta.54, basic browser checks show a score without a saved assessment
profile. Posts default to Article; Pages and custom content types use General
content. A saved profile overrides this browser-only default. It never saves
a profile, starts server analysis or follows schema output.

Saved results from analyzer 21 or earlier remain readable in history, but show
"Earlier analyzer. Analyze again." instead of a current number, band or
comparison. Trends restart with analyzer 22; earlier snapshots are not averaged
or paired with new ones. Stored profiles and history are preserved.

The upgrade itself does not reanalyze entries, write history, start a scan or
activate automatic analysis or providers. The analyzer version is part of each
saved score's input identity. The next explicit Save analysis, already-enabled
automatic save check or deliberately resumed scan analyzes each entry again
once, even when its content is unchanged. It writes a current score and, when
history is enabled, one history snapshot, using host CPU and database storage.

A scan started with an earlier analyzer pauses once for the policy change when
it next continues or resumes. Review its scope and choose Resume again to use
analyzer 22. A scan you paused before updating stays paused until you resume it.

The version-specific sections below describe changes introduced by earlier
candidates. Their statements about analyzer 21 describe those historical
updates; the analyzer 22 rules above also apply when moving to beta.54.

## From 0.4.0-beta.39 or beta.40

These versions score with analyzer 20 and have no content type rule. The
changes in [From 0.4.0-beta.43](#from-040-beta43) and the robots changes in
[From 0.4.0-beta.44](#from-040-beta44) and
[From 0.4.0-beta.47](#from-040-beta47) also apply. The update needs no data
migration: settings keep storage version 1, and stored records, scores and
history stay in place.

Saved scores show "Earlier analyzer. Analyze again." until each entry is
analyzed again, and trends restart; see [Score analyzer 22](#score-analyzer-22)
for the one-time analysis cost. A scan started in these versions pauses once
for a policy change when it continues.

The content type noindex rule in Indexing rules starts empty, so no entry
gains noindex from the update, unless the site ran `0.4.0-beta.42` or later
before, for example before a rollback. A content type rule stored then is
kept by these versions and applies again on the upgrade: every entry of that
type renders noindex,nofollow and leaves the sitemap. Check Indexing rules
after the upgrade; see [Roll back deliberately](#roll-back-deliberately). Add
a rule only when the owner wants every entry of a content type kept out of
search.

Code that imports `SEO_SNIPPET_TITLE_PIXEL_LIMIT`,
`SEO_SNIPPET_DESCRIPTION_PIXEL_LIMIT` or `estimateSeoSnippetWidth` from the
admin contract must stop doing so; those exports were removed in
`0.4.0-beta.41`.

## From 0.4.0-beta.47

This update needs no data migration. Settings keep storage version 1, stored
records, scores and history stay in place, and analyzer 21 is unchanged.
Saved scores read as needing refresh after the update, because the plugin
version is part of each score's input identity; the first automatic save
check, scan or Analyze for each entry analyzes it again once.

On a published content entry with Advanced robots directives, such as
`nosnippet`, the directives are now added to the theme's own robots value
instead of replacing it. A theme value of `noindex, follow` with `nosnippet`
renders `noindex,follow,nosnippet`; earlier versions rendered `nosnippet`
alone, so such a page could be indexed. The site-wide noindex, content type
rules, the entry's own noindex and a legacy override's robots value still set
the value the directives are added to. An entry's theme robots value is now
written in lowercase and comma-separated, as on other pages. Check the robots
tag of entries that use Advanced directives after the update.

The admin changes, such as the entry lock notice in Edit SEO and the save
reports on the settings pages, are listed in the [changelog](CHANGELOG.md).

## From 0.4.0-beta.45 or beta.46

The entry robots change in [From 0.4.0-beta.47](#from-040-beta47) also
applies. Apart from that, this update changes the admin: sitemap address
layout, editor panel states, dialog focus, disclosure markers and wording. The
entry preview read is no longer repeated on its own after a failure; **Retry
preview** and **Retry checks** each send one request. It needs no data
migration: settings keep storage version 1, stored records, scores and history
stay in place, and analyzer 21 is unchanged. Saved scores read as needing
refresh after the update, because the plugin version is part of each score's
input identity; the first automatic save check, scan or Analyze for each entry
analyzes it again once.

## From 0.4.0-beta.44

The entry robots change in [From 0.4.0-beta.47](#from-040-beta47) also
applies.

This update needs no data migration. Settings keep storage version 1, stored
records, scores and history stay in place, and analyzer 21 is unchanged.

A page whose theme passes its own robots value with noindex, such as
`noindex, follow` on a custom page, now keeps that value instead of
`noindex,nofollow`. The site-wide noindex and content type rules in Indexing
rules still render `noindex,nofollow`, and taxonomy archive rules still add
`noindex`.
Check the robots tag of such pages after the update.

Saved scores read as needing refresh after the update, because the plugin
version is part of each score's input identity; the first automatic save
check, scan or Analyze for each entry analyzes it again once.

## From 0.4.0-beta.43

The robots changes in [From 0.4.0-beta.44](#from-040-beta44) and
[From 0.4.0-beta.47](#from-040-beta47) also apply.

This update needs no data migration. Settings keep storage version 1, stored
records, scores and history stay in place, and analyzer 21 is unchanged.
`shipitSeo()` accepts an optional third argument for branding; the two-argument
form works as before.

Admin and analysis sentences no longer name the product, for every
installation. Saved scores keep their stored text and show the current
wording; the stored rows are not rewritten. Downloaded configuration backups
and legacy record copies are named `seo-configuration-*`,
`seo-pre-import-configuration-*` and `seo-legacy-*`; their contents and
formats are unchanged. Saved scores read as needing refresh after the update,
because the plugin version is part of each score's input identity; the first
automatic save check, scan or Analyze for each entry analyzes it again once.

## From 0.4.0-beta.41 or beta.42

The changes in [From 0.4.0-beta.43](#from-040-beta43) and the robots changes
in [From 0.4.0-beta.44](#from-040-beta44) and
[From 0.4.0-beta.47](#from-040-beta47) also apply.

This update needs no data migration. Settings keep storage version 1, stored
records, scores and history stay in place, and analyzer 21 is unchanged.

Coming from `0.4.0-beta.41`, the content type noindex rule in Indexing rules
is new and empty by default, so no entry gains noindex from the update. Coming
from `0.4.0-beta.42`, a saved content type rule stays in place. Add a rule only
when the owner wants every entry of a content type kept out of search.

Saved scores read as needing refresh after the update, because the plugin
version is part of each score's input identity. The first automatic save
check, scan or Analyze for each entry analyzes it again once, writing one
current score and, when score history is enabled, one history snapshot. Trends
continue with analyzer 21. Description fit now measures the description after
a publication date shown before it, as the preview does. Coming from
`0.4.0-beta.41`, image alt text also counts body images only, and heading
advice no longer applies to General content under 300 words without headings.
A score can therefore change without a content change. A scan started in these
versions does not pause for this update.

## Roll back deliberately

A deliberate rollback returns to the previous package and keeps the stored
data. It follows the same order as an update:

1. Confirm pending saves, pause scans and optional automatic analysis, and
   turn IndexNow delivery and automatic submission off through their controls.
2. Export the configuration in Export & import as a settings backup. It
   includes the content type rule.
3. Gracefully stop every application instance, worker and scheduler, and take
   a consistent database/uploads backup of the current state.
4. Restore the previous manifest, lockfile and configuration from the backup
   taken before the update. Install from that lockfile with the site's package
   manager so the previous exact version returns, and keep one lockfile.
5. Keep the plugin data in place. Do not delete records, reset storage or run
   SQL cleanup.
6. Run the site's checks and production build, restart, and repeat
   [Verify before reopening the site](#verify-before-reopening-the-site).

Versions before `0.4.0-beta.42` do not read the content type rule. While such a
version runs, entries of a ruled type lose that noindex and the type's saved
sitemap choice applies again. The rule stays stored, but saving Search &
social, Website or Indexing rules in that version removes it. After upgrading
again, check Indexing rules; if the rule is gone, recreate it or preview and
import the settings backup.

Versions before `0.4.0-beta.45` rewrite a theme robots value that contains
noindex, such as `noindex, follow`, to `noindex,nofollow`. Versions before
`0.4.0-beta.48` drop the theme's robots value on an entry with Advanced robots
directives, so a theme `noindex` on such an entry does not reach the page while
that version runs. Check the robots tag of those pages after a rollback.

Versions before `0.4.0-beta.44` do not read a `branding` argument: they show
their default name and sentences, and a `branding` argument left in the
configuration has no effect while such a version runs.

An older version does not convert scores or history written by a newer one.
Analyze an entry again in the older version when it needs a current score.
Restore the database snapshot only when stored data must return to its earlier
point, as in [Recover a failed update](#recover-a-failed-update), and account
for the writes it discards.

## Recover a failed update

Stop all writers before reconciling the result. Restore the previous manifest,
lockfile and configuration through the tested recovery process. If stored data
changed, restore its matching database/uploads snapshot before reopening the
site. With SQLite, first move the failed state's database file and its `-wal`
and `-shm` files aside together, then put the snapshot in place: a `-wal` file
left beside a restored database is replayed over it and brings the discarded
changes back without an error. Installing an older package alone does not
reverse data changes or host migrations. Restoring a snapshot also restores its
point-in-time data, so account for any writes made since it was taken. Never delete plugin records as a shortcut.

Rebuild and verify the recovered site and public output. Do not assume automatic
rollback, zero downtime or that cached responses change immediately. For removal
while retaining data, follow [UNINSTALL-PROMPT.md](UNINSTALL-PROMPT.md); disabling,
removing the package and deleting data are different operations.
