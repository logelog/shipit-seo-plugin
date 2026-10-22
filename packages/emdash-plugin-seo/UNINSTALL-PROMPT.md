# Remove Shipit SEO while keeping its data

Copy the request below into your site's development task. It covers the native
Shipit SEO installation on EmDash and admin 1.3.0 or 1.3.1 with Node and SQLite. Start
with an isolated copy; this request does not authorize production removal,
deployment, data deletion or IndexNow submission.

```text
Remove @shipitseo/emdash-plugin-seo from this isolated site copy while keeping
all existing content, settings, plugin data, database records and uploads.
Verify the resulting admin and public output.

First inspect the repository's instructions, installed package versions,
manifest/lockfile, Astro configuration, EmDash setup and public templates.
This guide covers native EmDash and @emdash-cms/admin 1.3.0 or 1.3.1 on Node with
SQLite. Report a different host/runtime/database before changing it. Do not
upgrade EmDash or use a registry plugin's Uninstall or Delete data flow for
this native npm installation.

Record the current public output and intended indexing policy. Removing
Shipit SEO stops its metadata, social exceptions, extra robots directives,
JSON-LD, custom verification tags and public-file contributions. Google/Bing
verification codes remain in core settings and retain their core output. Its
site-wide, content type and selected-taxonomy archive noindex restrictions
also stop applying. Identify the owner that will preserve any required
restrictions before proceeding; do not silently make restricted pages
indexable. Core entry SEO, saved core robots.txt, redirects, content and media
stay with EmDash. Existing SEO values migrated into core stay there.

If templates import taxonomyArchivePage, remove that package import and its
wrapper while retaining the underlying custom page context, EmDashHead and
archive route. Transfer any required archive noindex restriction to its new
owner before disabling Shipit. Moving it into a template, for example as the
page context's seo robots value, needs its own production build and restart
before Disable. From 0.4.0-beta.45 Shipit keeps the directives of a template
robots value that already contains noindex, written in lowercase and
comma-separated (noindex, follow becomes noindex,follow), so check the moved
value in the public page source before Disable. Earlier versions rewrite it to
noindex,nofollow, so there the moved value can only be checked after Disable.
Do not delete existing archive pages or alter assigned posts to compensate for
removal.

Before disabling the plugin, stop the current score scan through its controls
and confirm in Content health that no scan is running. In Feature controls,
choose Pause automatic & bulk for automatic and bulk analysis.
Stop automatic IndexNow submission and turn IndexNow delivery off if enabled,
then confirm on the IndexNow page that both are off. Do not send pending URLs
just to empty the queue. Reconcile pending saves, analysis, imports, migrations
and delivery attempts before continuing. Closing a browser tab does not prove
that server work stopped. A request already running can still finish; disabling
the plugin cannot undo a provider request already received.

IndexNow Off keeps its public verification key, queue and history, and the key
can still be served at /indexnow-key.txt. It does not cancel every scheduled
or already running task.

While the package and configuration are still installed, use Disable for the
plugin listed as shipit-seo in EmDash's plugins manager and confirm that it
lists the plugin as inactive. EmDash 1.3 has no supported view of a plugin's
scheduled tasks: rely on the scan and IndexNow checks made before disabling,
and report that scheduled tasks could not be inspected directly. After Disable, Shipit SEO
leaves the EmDash admin menu and the content editor, and its plugin API routes
return 404. Opening its admin page directly shows "SHIPIT SEO is disabled.
Enable it in EmDash Plugins to use these settings. Saved data is kept.", with
the configured name in place of SHIPIT SEO when branding is set. Its
hooks should stop receiving new work, and its injected /indexnow-key.txt route
should return 404. An existing independently owned key file or route keeps its
own behavior. Removing the Astro wrapper or npm package alone does not run this
Disable step.

Gracefully stop all site application instances, workers and schedulers before
backing up or replacing dependencies. Use the site's established process to
take a consistent database/uploads backup and retain the matching configuration,
package manifest and lockfile, and any package archive the lockfile refers to.
Verify restoration on an isolated copy. Do not copy a live SQLite file while a
writer is active.
Use a SQLite-aware backup that preserves committed WAL data; copying only the
main database file can omit saved changes even after writers stop.
A configuration export alone does not contain all plugin or content-owned data.

Keep all Shipit data, including settings and custom verification tags, templates,
business identity, custom schemas and the schema library, overrides, analysis profiles, scores/history,
scan state, migration/recovery records and the IndexNow key/queue/history.
Do not delete records, reset storage or run SQL cleanup. This guide does not
provide a data-purge operation.

In the existing Astro configuration, replace shipitSeo(emdash, options) with
the original emdash(options) call. Preserve the entire options object:
database, storage, collections, locales, other plugins, adapter and integrations.
Remove only the Shipit import and any verified Shipit descriptor or adapter
left by this site's installation. A branding argument goes with the wrapper;
remove its logo files from public/ only when nothing else in the site uses them. Keep EmDash registered once. Inspect any
handwritten Shipit route imports before removing them; preserve independently
owned routes and files. Remove the package name from any other build setting
that lists it, such as a Vite ssr.noExternal entry, and update site-owned links
to the Shipit admin page under /_emdash/admin/plugins/shipit-seo/. After
removal that address shows EmDash's "Plugin Error" message, "Plugin responded
with 404", followed by the raw JSON response, not a not-found page.

Keep EmDashHead, its correct page/content context, body hooks and the theme's
title integration. These remain part of the site's EmDash setup.

Use the site's existing package manager to remove only this dependency:
  pnpm remove @shipitseo/emdash-plugin-seo
For npm, use npm uninstall @shipitseo/emdash-plugin-seo; removal and
reinstallation with npm are not verified for this release, so report that and
review the lockfile diff before continuing. Use the equivalent command for
another package manager. Update its existing lockfile through that command and
keep other dependencies; do not create another lockfile.

Run the site's relevant checks and production build, then restart locally.
Verify:
- Shipit SEO is absent from the admin and no Shipit package import remains.
- The intended public title, description, canonical, social metadata, robots
  directives and JSON-LD come from the remaining owners without duplicates.
- /sitemap.xml and child files reflect their remaining owner. EmDash's sitemap
  can differ from Shipit's saved selection; review private/noindex exclusions.
- /robots.txt retains the intended core or independently owned rules.
- Absolute URLs in EmDash's sitemap and robots.txt use EmDash's stored site
  URL; confirm that it names the intended public origin.
- /llms.txt and /indexnow-key.txt reflect their remaining route/file owner.
  Shipit's injected key route should be absent after rebuilding.
- Existing EmDash redirects and core entry SEO still work.
- Retained plugin records, content and uploads remain available for recovery.

Use the site's established cache invalidation process when needed. A response
already cached by a browser or CDN can outlive the configuration change.
Do not claim that removing the package immediately clears every public cache.

Reinstallation reuses retained data and can retain the inactive state; while
inactive, the SEO admin page shows only the disabled notice and its API routes
return 404, so EmDash 1.3 offers no supported way to review the retained
settings or IndexNow queue before Enable. Enable resumes the retained settings
and scheduled work at once: content scoring, IndexNow delivery and automatic
submission run again if they were left on, and a scan left running can continue.
The steps above save them off before removal, which prevents that. If they
were not saved off, open Content health, Feature controls and IndexNow
immediately after Enable: stop the scan, choose Pause automatic & bulk and turn
automatic submission and IndexNow delivery off before anything else. Then
review the retained settings and queue before deliberately resuming any of
them. Do not promise a fresh installation, empty queue or restored output
without checking.

If removal fails, keep the site stopped while reconciling the result. Restore
the matching package manifest, lockfile and configuration through the tested
recovery process. Restore database/uploads only from the matching consistent
backup if data recovery is required. With SQLite, move the current database
file and its -wal and -shm files aside together before putting the backup in
place; a -wal file left beside a restored database is replayed over it.
Reinstalling a package alone does not reverse data changes or automatically
enable the plugin.

Report the files changed, exact versions and checks, confirmed disabled state,
backup/recovery evidence, retained data and observed public fallback behavior.
Describe any outstanding operation whose completion could not be confirmed.
Do not publish, deploy, remove production installations, purge data or submit
IndexNow requests as part of this task.
```
