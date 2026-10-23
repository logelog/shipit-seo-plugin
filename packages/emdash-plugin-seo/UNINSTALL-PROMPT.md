# Remove Shipit SEO while keeping data

Rehearse removal on a copy of the site. Disabling the plugin, removing its
package and deleting its data are separate operations. This guide retains
data; the beta provides no purge workflow.

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

## 1. Plan the remaining output

Record the current versions, configuration and intended indexing policy.
Disabling Shipit stops its metadata, JSON-LD, verification tags, public-file
contributions and noindex rules. Transfer required restrictions to their
remaining owner before disabling; do not silently make restricted pages
indexable.

Native EmDash SEO, content, media, core robots settings and redirects remain
with EmDash. Independently owned public files and routes keep their own
behavior. Do not delete taxonomy archives or alter assigned posts to compensate
for removal.

## 2. Stop optional work, then disable

While the package and configuration are still installed:

1. Stop the current scan and confirm Content health has no running scan.
2. Choose Pause automatic & bulk in Feature controls.
3. Turn off automatic IndexNow submission and IndexNow delivery. Do not send
   pending URLs merely to empty the queue.
4. Reconcile pending saves, imports, analysis and delivery requests.
5. Disable the plugin listed as shipit-seo in EmDash's plugins manager and
   confirm it is inactive.

Closing a tab does not stop every server request. Already dispatched work can
finish, and disabling cannot recall a provider request. EmDash 1.3 has no
supported scheduled-task view; make the scan/delivery checks before Disable.

IndexNow Off retains the public key, queue and history and can still serve
the key file. Disabling the plugin stops its injected key route. The disabled
SEO admin page shows a notice; saved data remains stored. Plugin API routes
return 404.
Removing the wrapper or dependency alone does not perform this Disable step.

## 3. Keep a restorable backup

Gracefully stop every application instance, worker and scheduler. Back up
the consistent database/uploads state with the matching configuration,
manifest, lockfile and any package archive referenced by it. Verify restoration
on a copy. For SQLite, include committed WAL data rather than copying only the
main database.

Retain all content and plugin records, including identity, templates, custom
schemas, Library, profiles, scores/history, migration records and IndexNow
keys/queues/history. A configuration export omits some of these records and
is not a full backup.

## 4. Remove the integration and dependency

Restore the original EmDash call, preserving every existing option:

```diff
- shipitSeo(emdash, options)
+ emdash(options)
```

Remove only the Shipit import and verified Shipit-specific adapters or build
settings. Keep EmDash registered once, its complete options, adapter,
database, storage, collections, locales and other plugins.

If templates use taxonomyArchivePage, remove its import and wrapper while
retaining the underlying custom page context, EmDashHead, archive route and
content. Keep body hooks and the theme's title integration. Remove branding
logo files only if nothing else uses them.

For a pnpm site:

```sh
pnpm remove @shipitseo/emdash-plugin-seo
```

For npm, use this instead. npm removal and reinstallation remain unverified
for this beta; rehearse them on a copy and review the lockfile:

```sh
npm uninstall @shipitseo/emdash-plugin-seo
```

Keep one lockfile and remove no unrelated dependency. Do not use a registry
plugin's Delete data flow for this native package.

## 5. Build and verify

Run the site's checks and production build, restart, then confirm:

- Shipit is absent from the admin and no package import remains.
- Remaining owners supply the intended title, description, canonical, social
  values, robots directives and JSON-LD without duplicates.
- Sitemaps retain the intended private/noindex exclusions. Check the remaining
  ownership of robots.txt, llms.txt and indexnow-key.txt.
- Native SEO, redirects, content and uploads remain available.
- Plugin data remains stored for recovery.

Use the normal hosting cache invalidation procedure. Cached responses can
outlive a configuration change.

## Reinstall or recover

Reinstallation reuses retained records and can keep the plugin inactive.
EmDash 1.3 offers no supported inspection of the retained settings or queue
before Enable. Enabling immediately resumes saved settings and scheduled work,
so the steps above turn optional work off before removal.

If work was left on, stop scans, automatic/bulk analysis and IndexNow delivery
immediately after Enable, then review settings and queues before deliberately
resuming them. Do not promise a fresh installation or empty queue.

If removal fails, keep the site stopped and restore the matching package
manifest, lockfile and configuration. Restore database/uploads only when
needed, using the matching consistent backup. With SQLite, move the failed
database, -wal and -shm files aside together before restoration, and account
for later writes. Reinstalling a dependency alone does not restore data or
automatically enable the plugin. See [UPGRADE.md](UPGRADE.md#recover-a-failed-update).
