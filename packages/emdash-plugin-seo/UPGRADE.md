# Upgrade Shipit SEO

<!-- compatibility:package:start -->
Version `0.4.0-beta.56` is a native beta.

Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:package:end -->

Try updates on a copy first. Choose a release from the
[changelog](CHANGELOG.md) and its requirements; a higher beta version does not
guarantee a safe downgrade. Keep host upgrades separate from plugin updates.

Native updates use the site's package manager and a rebuild. EmDash's plugins
manager can enable or disable the installed plugin, but does not update an
npm-installed dependency. The beta channel moves; pin the selected version.

## Prepare and rehearse

1. Record current and target versions, EmDash/admin/runtime versions, package
   manager, manifest, lockfile and configuration.
2. Finish pending saves and reconcile conflicts or uncertain writes.
   Pause scans and automatic analysis, and turn IndexNow delivery and
   automatic submission off. Already dispatched requests can still finish.
3. Gracefully stop all application instances, workers and schedulers.
4. Take a consistent database/uploads backup with the matching manifest,
   lockfile, configuration and any local package archive referenced by the
   lockfile. Test restoration on an isolated copy.

For SQLite, preserve committed WAL data. Copying only the main database file
can omit saved changes even after writers stop. A configuration export is a
settings transfer, not a full site backup.

## Update the dependency

Keep the shipit-seo ID, stored data, activation state and complete integration
options. Do not uninstall as an upgrade step or replace the host to resolve
an unreviewed compatibility mismatch.

For a pnpm site:

```sh
pnpm add --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.56
```

For npm, use this instead; review the lifecycle limits below before proceeding:

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.56
```

Keep one lockfile and review its diff. Retain the Astro wrapper, host adapter,
database, collections, locales, other plugins and public templates. Branding
stays in site configuration and public logo files across updates.

Run the site's checks and production build, then restart the copy.

## Verify before reopening the site

- Confirm the exact version in the installed package manifest and the intended
  activation state. EmDash 1.3 can retain an earlier version in its internal
  plugin records; those records are not the installed package manifest.
- Check keywords, browser checks and readable previews with automatic
  analysis still off. Saved scores may need refreshing.
- Confirm native SEO, schemas, image inheritance, site settings and indexing
  rules. Save scopes remain separate from the content draft.
- Inspect anonymous title, canonical, description, robots, social metadata
  and JSON-LD, then relevant sitemaps, robots.txt, llms.txt and redirects.
- Check connected taxonomy archives separately from assigned posts.
  Review the site's normal cache invalidation procedure.
- Confirm the update did not activate automatic work or submit URLs.
  Review retained settings and queues before deliberately resuming them.

Keep settings, schemas, library templates, profiles, scores/history, migration
records, IndexNow data, content and uploads. Updating does not authorize
deleting, resetting or reimporting them.

## Tested update paths

This beta does not claim a verified update from every earlier evaluation
build. Earlier local archive tests do not qualify changed archives. npm
update, removal and reinstallation remain unverified; rehearse those operations
on a copy and inspect the lockfile before changing a real site.

Beta.56 passed native 1.3.1 quick verification and focused local Workers/D1
checks. Earlier full native 1.3.0 and focused 1.3.1 installation checks apply
to beta.55, not every later archive. See the
[compatibility coverage](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/compatibility.md)
and [package limits](README.md#limits) for the checked scope.

Live IndexNow delivery was verified with beta.55 on native EmDash 1.3.0 using
Node/SQLite. Workers/D1 delivery and other automatic event and retry flows
remain unverified.

Earlier @shipit-scoped alpha packages have no tested or supported migration
path to this package. Treat that as a separate migration with its own backup
and rehearsal.

## Scores and earlier evaluation builds

The plugin and analyzer versions are part of saved-result identity. An upgrade
does not reanalyze entries, start a catch-up scan or backfill history. An earlier
analyzer result stays stored without a current number or comparison. A resumed
scan crossing an analyzer change pauses for policy review. Optional work
remains subject to its existing activation.

Available in **0.4.0-beta.57 (unreleased)**: analyzer 24 marks stored results
from analyzer 23 and earlier **Earlier analyzer. Analyze again.** Opening an
entry runs current basic browser checks, including the maximum of 79 without
a focus keyword, without rewriting its saved result or history.

To refresh a stored result deliberately, confirm its assessment profile, then
choose **Analysis options > Saved analysis & history > Save analysis**. With
automatic server analysis paused, this updates the current result without
adding history. For several entries, review the scope and optional feature
controls before starting a selected bulk run. See the
[content checks guide](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/content-checks.md) for the current score and
body-reading rules.

Keep these older-reader limits in mind when recovering an evaluation build:

| Earlier version | Behavior to check |
| --- | --- |
| Before beta.42 | Content-type noindex rules are ignored; saving relevant settings can remove them |
| Before beta.44 | The branding argument has no effect |
| Before beta.45 | A theme robots value containing noindex is rewritten to noindex,nofollow |
| Before beta.48 | Advanced entry directives replace the theme robots value, which can drop its noindex |

An absent preference in the current beta adds no site-wide restriction.
Confirm the saved indexing policy rather than relying on an older unsaved
default. Do not use an old package as a data-repair tool.

## Roll back deliberately

Stop optional work and writers, back up the current state, then restore the
previous manifest, lockfile and configuration. Install the previous exact
dependency from that lockfile with the same package manager. Keep all plugin
records unless a matching database restore is required.

An older package alone does not undo data changes or host migrations.
Check its indexing behavior and saved data before reopening. Scores and
history are not converted automatically for the older reader.

## Recover a failed update

Keep the site stopped while reconciling the result. Restore the previous
manifest, lockfile and configuration through the rehearsed procedure.
If stored data changed, restore the matching database/uploads snapshot.

For SQLite, first move the failed database and its -wal and -shm files aside
together, then restore a coherent snapshot. Leaving the old WAL beside a
restored database can replay unwanted changes. Account for content, settings
and uploads saved after the restore point: restoring the snapshot discards
those later writes.

Rebuild, restart and check the recovered site. Do not delete records, assume
automatic rollback or promise that every cache changes immediately.
For removal while retaining data, follow
[UNINSTALL-PROMPT.md](UNINSTALL-PROMPT.md).
