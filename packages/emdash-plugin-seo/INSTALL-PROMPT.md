# Install Shipit SEO

Use this guide to add Shipit SEO to an existing native EmDash site.
Try the installation on a copy first. For an existing Shipit installation,
read [UPGRADE.md](UPGRADE.md); for removal, see
[UNINSTALL-PROMPT.md](UNINSTALL-PROMPT.md).

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

## 1. Check the site

Record the host and package versions, package manager, lockfile and Astro
configuration. Keep the site's existing database, adapter, storage, content,
uploads and other plugins. Installing Shipit is not a host upgrade.

Take a restorable database/uploads backup with the matching configuration,
manifest and lockfile. For SQLite, use a consistent backup that includes
committed WAL data; copying the main database alone can omit saved changes.
Do not reset, reseed or import content to install the plugin.

Workers/D1 coverage is experimental. The recorded beta.56 checks do not
qualify later archives; review the version-specific
[compatibility coverage](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/compatibility.md)
before using that runtime. Postgres and sandbox/registry installation remain
unqualified.

Earlier @shipit-scoped alpha installations have no supported migration path to
this package; treat that transition separately.
See [the package limits](README.md#limits).

## 2. Install the exact beta

For an npm site:

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.57
```

For a pnpm site, use this instead:

```sh
pnpm add --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.57
```

Use one package manager and one lockfile. Review the dependency changes;
do not install a separate Shipit admin package.

## 3. Connect the existing integration

Add this import to the existing Astro configuration:

```js
import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";
```

Replace the existing call, where options means its complete current options
object and emdash is the existing default import from emdash/astro:

```diff
- emdash(options)
+ shipitSeo(emdash, options)
```

Keep every option, including database, storage, collections, locales and other
plugins, as well as the site's adapter and other integrations. Register EmDash
once. If an earlier direct Shipit installation lists seoPlugin(), remove only
that entry when adopting the wrapper; keep its stored shipit-seo data.

Optional admin branding belongs in the third wrapper argument, as described
in [Use your own name and logo](README.md#use-your-own-name-and-logo).

## 4. Check templates and public addresses

Keep EmDashHead from emdash/ui in public layouts, with the correct page or
content identity and locale. Preserve body hooks and the theme's title
integration. The theme owns the single HTML title; Shipit title templates do
not automatically replace it. Check that the theme uses a saved native SEO
title when one is set.

Keep Astro's site origin, EmDash's configured or stored Site URL and the
production URL in Shipit's Website settings consistent with the real public
address. A local origin works for local checks but cannot enable IndexNow.

For an existing taxonomy archive, bind its actual custom page context before
passing it to EmDashHead:

```js
import { taxonomyArchivePage } from "@shipitseo/emdash-plugin-seo/taxonomy-archives";

// context and term come from this archive's existing page implementation.
const page = taxonomyArchivePage(context, term.name);
```

Use the resolved taxonomy name. Keep the route, content and canonical.
Do not mark ordinary content entries as archives or invent archive routes.
An unconnected template receives no archive rule; check a selected archive
and an assigned post separately.

## 5. Build, restart and configure

Run the site's existing checks and production build, then restart the copy.
Sign in as an administrator and open SHIPIT SEO, or its configured admin name.

In Local SEO, save the Website name and production URL through Edit website.
Complete and save the publisher separately. Review sharing defaults and
Indexing rules without changing the intended indexing policy.
Keep optional automatic analysis and IndexNow off during installation.

## 6. Verify one page

- Open a saved entry. Focus keywords, preview and basic checks should work
  without enabling automatic analysis.
- Save other content edits first, then use Edit snippet and Save SEO fields.
  Confirm the native title and description persist after reopening. Social
  text and native image choices have separate save ownership.
- Inspect anonymous HTML for the theme's one title, intended description,
  one canonical, social metadata and JSON-LD. Check publication/noindex rules
  and the relevant locales.
- Inspect sitemap.xml and robots.txt, plus llms.txt if already enabled.
  Follow the ownership shown in the admin; another route or file can own them.
  Keep private or members-only pages out of sitemap selections.
- Confirm no scan started, no analysis feature was activated and no URLs
  were sent to a provider.

If a save conflicts or its outcome is unclear, retain the draft and use the
offered saved-value check before another deliberate save. Do not reload away
unsaved work. Native SEO and schemas can change a published page immediately,
independently of the content draft.

A valid preview or JSON-LD graph does not prove indexing or rich-result
eligibility. Use [the package guide](README.md) for daily workflows and limits.
