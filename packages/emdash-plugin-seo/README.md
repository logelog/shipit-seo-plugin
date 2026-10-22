# Shipit SEO

Native SEO tools for EmDash: metadata, structured data, content checks,
sitemaps, redirects and IndexNow in one package.

<!-- compatibility:package:start -->
Version `0.4.0-beta.54` is a native beta.

Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:package:end -->

Earlier 0.4.0 betas were pre-release candidates and were not published.
Validate this beta
on a separate copy of your site before a production upgrade. Cloudflare
Workers/D1, Postgres and sandbox/registry installations are outside this
beta's verified scope. Live IndexNow provider delivery, full multilingual use
of the Edit SEO dialog, such as switching locales, and updating or removing the
package with npm are not verified; see [Limits](#limits) and
[UPGRADE.md](UPGRADE.md#tested-update-paths).

Shipit SEO runs in the trusted host process. Install only a package you trust;
this native plugin does not provide sandbox isolation. Use the tested host
versions above; other host versions have not completed this beta's support checks.

## Install

Install the exact beta:

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.54
```

Use your existing package manager if the site uses pnpm or another lockfile.
Keep EmDash, its admin and React on the site's compatible versions; do not
upgrade the host or replace its database to add this plugin. No separate
Shipit admin package is required.

In the existing Astro configuration, import the integration:

```js
import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";
```

Wrap the **existing** EmDash call, keeping its complete options object:

```diff
- emdash({
+ shipitSeo(emdash, {
    // Keep every existing EmDash option and other plugin here.
  })
```

`emdash` is the existing default import from `emdash/astro`.
`shipitSeo(emdash, options)` replaces that integration and registers Shipit SEO
once. Keep the site's adapter, database, storage, collections, locales, other
plugins and other integrations. Do not add a second `emdash()` call or a
`seoPlugin()` entry alongside the wrapper.

For an existing direct Shipit installation, remove its `seoPlugin()` entry
when switching to the wrapper. Preserve the other plugins and existing stored
settings; the plugin ID remains `shipit-seo`. An obsolete
`@shipit/emdash-plugin-seo-admin` companion is not required by this version.
Moving from the earlier `@shipit`-scoped alpha packages to this package is
untested and unsupported in this release. Before trying it, take a consistent
backup, restore it to an isolated copy and make the change there first.

Keep the site's real canonical address in Astro's `site` setting. IndexNow
requires a public HTTPS origin at the root path, without a custom port.
A local address still allows the SEO workspace to open, with IndexNow
unavailable. Do not substitute an example origin in an existing site.

Sitemap addresses, the `Sitemap:` line in robots.txt and publisher structured
data take EmDash's site address before Astro's `site`: the `siteUrl` option of
the EmDash integration, then the `EMDASH_SITE_URL` (or `SITE_URL`) environment
variable, then the **Site URL** in EmDash's settings; robots.txt reads that
**Site URL** first. A production URL saved in the SEO **Website** settings
comes before all of them for sitemaps, publisher structured data and the site
paths in an entry's sharing tags and canonical link, such as a stored SEO,
featured or default social image or a stored canonical. When the entry's
stored SEO image is its sharing image, the structured data this plugin adds,
such as its BlogPosting or WebPage, uses that address too; with the
BlogPosting default off, EmDash adds its own BlogPosting, whose image keeps
EmDash's **Site URL**. The IDs in an entry's structured data follow the page
address EmDash passes to plugins, which can use another origin, such as EmDash's
**Site URL**. Keep every one of these that is set equal to the site's public
address.

Publisher structured data names the website after the website name saved in
the SEO **Website** settings, or else the site title that EmDash's setup wizard
stores (`emdash:site_title`). A seed or import that stores only `site:title`
does not set that title. With neither, the website and the organization in
publisher structured data are both named **Website**, so save the website
name in the SEO **Website** settings. That save does not rename the
organization; save the publisher in **Local SEO** with its **Public name** for
that.

Restart the site, sign in as an administrator and open **SHIPIT SEO** in EmDash,
or the name set in [`branding`](#use-your-own-name-and-logo).
For a copyable installation request, use [the installation prompt](INSTALL-PROMPT.md).

## Use your own name and logo

An agency can show its own product name and logo in the EmDash admin. Set them
once in the site's `astro.config.mjs`, as the third argument of `shipitSeo()`:

```js
shipitSeo(emdash, {
  // Keep every existing EmDash option and other plugin here.
}, {
  branding: {
    name: "Acme SEO",
    logo: "/brand/acme-seo.svg",
    logoDark: "/brand/acme-seo-dark.svg",
  },
})
```

- `name` is required when `branding` is set. It becomes the admin menu entry,
  the command palette entry, the workspace heading, the title of the page shown
  while the plugin is disabled, and the hints that point into the workspace.
  Use 1 to 32 characters; leading and trailing spaces are removed. Long names
  wrap in the workspace heading, and how much fits on one line depends on the
  letters, so check the heading after setting the name. The admin menu may
  shorten a long name, and the build prints a warning for a name longer than
  16 characters. Control, line break and text direction characters and
  `{ } \ < >` are refused.
- `logo` is optional. Put the file in the site's `public/` directory and write
  its site path: `/brand/acme-seo.svg` for `public/brand/acme-seo.svg`. Use an
  `.svg` file of at most 64 KiB, or a `.png` or `.webp` file of at most
  256 KiB whose content matches its extension. Each side must be 64 to 2048 px;
  give an SVG `width` and `height` in px, or a `viewBox`, on its `<svg>`
  element. The logo is shown in a 38 px square and keeps its proportions, so a
  square image of at least 96 px works best. An SVG must not contain scripts,
  event handler attributes, `foreignObject`, DOCTYPE or ENTITY declarations,
  `javascript:` addresses, imported style sheets or references to other files;
  only `#fragment` references are allowed. Remote and `data:` addresses, `..`
  segments and symbolic links are refused.
- `logoDark` is optional and needs `logo`. It follows the same rules and is
  shown while the admin uses its dark theme. Without it, `logo` is shown in
  both themes, so choose a logo that reads on light and dark backgrounds.

Each value is checked when Astro loads the configuration and again against the
final configuration. An invalid value stops `astro dev` and `astro build` with
a message that names the option, the value and the rule, for example
`shipitSeo branding.logo "/brand/logo.gif": must be an .svg, .png or .webp file.`
Restart the dev server after changing `branding` or replacing a logo file. The
logo address carries a hash of the file, so browsers load a replaced file after
the restart or rebuild.

Without `branding`, the admin shows **SHIPIT SEO** with its built-in mark. If
the recorded branding cannot be read at runtime, the admin shows the neutral
name **SEO** without a logo and the server log says so; public pages keep
working. The admin's other sentences name no product for any installation, and
download file names start with `seo-`. Public pages carry no product name.
The logo is decorative next to the visible name.

Branding lives in the site's configuration and `public/` directory, not in the
database or the package, so package updates keep it without any change.
Removing `branding` restores the default name and mark; stored data does not
change. Reading the logo adds no permission: the workspace makes one small
read per admin page load, and the build reads and hashes each logo file once.

These keep the technical `shipit-seo` id or the package name:

- EmDash's plugins manager lists the plugin as `shipit-seo`; EmDash 1.3 shows
  no display name for plugins configured in the site.
- The admin address `/_emdash/admin/plugins/shipit-seo/seo`, API paths under
  `/_emdash/api/plugins/shipit-seo/` and browser developer tools.
- The npm package, the `shipitSeo()` function and build errors that name it,
  stored option keys such as `plugin:shipit-seo:configuration:templates:v1`
  in recovery hints, and the export format `shipit-seo-portable`.
- The package's `LICENSE` and `THIRD-PARTY-NOTICES.md`. Keep both in the
  installed package: the MIT license requires its copyright and permission
  notice to stay with copies of the software, and the Schema.org catalogue
  keeps its CC BY-SA 3.0 notice. Neither requires the name in the admin.

## Other SEO plugins

Feature controls lists each active SEO plugin that overlaps with Shipit, one
row per plugin with its version, assessment and the Shipit features paused
while it is active. Deactivate one of the overlapping plugins through **Manage
plugins**, then select **Check again**. **Compatibility details** lists other
active plugins in the checked catalog. These actions do not deactivate plugins
automatically or import their data.

While an overlap is active, Overview and the pages whose output is paused show
a one-line notice; its **Review** button opens Feature controls. Those pages
are Search & social and Templates for metadata, Indexing rules for robots meta
tags, Schema and Schema library for structured data, and IndexNow.

A verified clear result shows **No overlapping SEO plugins found**. Loading,
failed checks and unassessed coverage remain visible without claiming a
conflict. The native adapter reads current activation from local plugin state.
One read serves the notices for each admin page load; Feature controls and
**Check again** read again. Checking does not contact a provider or change
settings.

An active Moorage SEO peer pauses Shipit Schema and ordinary robots output.
SEO Suite can pause search/social, robots and Schema; Instant Indexer pauses
Shipit IndexNow activity. Unassessed versions of these known output owners
remain potential overlap. Page SEO Inspector 0.1.1 is an inspection tool, not a
public-output owner. Future versions remain unassessed.

Custom verification tags remain separate from ordinary search/social output.
When an assessed active peer pauses that output, unrelated verification names
remain available; a collected tag with the same name takes precedence.
Unreadable inventory still pauses guarded Shipit output.

Readable saved restrictions are retained in a separately keyed robots tag.
[Google combines restrictive rules across tags](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag); other crawlers may differ.
Unrecognized rules need manual review. Inactive or absent assessed peers allow
Shipit to resume affected work after a fresh state check, within its saved
feature settings. IndexNow stays off until explicitly enabled. Pending jobs and
saved settings are retained; a previously dispatched request cannot be undone.

If plugin state is unavailable, Shipit pauses guarded output and IndexNow work.
Use **Manage plugins**, then **Check again** to inspect the current state. This
check does not deactivate another plugin, import its data or schedule catch-up
work. Its catalog covers four specific publisher identities plus recognized
configured entry points; other plugins, raw theme markup and trusted fragments
remain outside the assessment. An inventory result is not universal compatibility.

On the assessed 1.3.0 and 1.3.1 hosts, the integration also checks collected typed metadata
through the public facade used by `EmDashHead`. This catches peer output retained
by an in-flight request while activation changes. Only Shipit's contributions
are filtered; peer objects and the host's cached result stay unchanged. Custom
collector bypasses and trusted fragments are outside this guard. Detailed overlap
inspection covers up to 1,024 contributions; oversized output pauses ordinary
Shipit output while carrying readable robots restrictions. Filtering still takes
time proportional to the collected array.

The adapter uses one indexed, projected read of at most 32 exact IDs per
observation. An IndexNow queue or drain operation performs at most three
observations, rather than one for each URL. Automatic content events can make
one preliminary admission read before their queue operation. These bounds do
not cap hosting charges. Local package and configured-pair checks cover the
assessed native target; live IndexNow provider acceptance remains unverified
for this beta.

## Workspace navigation

The left navigation starts with Overview and groups the other pages under
headings: **Content** (Work queue, Content health, Trends), **Search
appearance** (Templates, Search & social, Schema, Local SEO) and **Settings**
(Feature controls, Site verification, Migration when relevant, Export &
import). Before Settings, one **Indexing** row opens Indexing rules. Schema
library is a tab of Schema and Website opens from Local SEO, so neither has its
own row. Existing links to a page still open that page. Opening a page does not
save changes or enable a feature.

Every indexing page starts with a row of its tools: Indexing rules, Sitemaps,
Robots.txt, llms.txt, IndexNow, Crawl diagnostics and Redirects & 404s. The
open tool is highlighted, and the **Indexing** row in the left navigation stays
highlighted on each of them. Choosing a tool opens its page without saving or
discarding changes on another page. On narrow screens, the SEO page selector
replaces the left navigation and lists every page under Content, Search
appearance, Indexing and Settings; the row of tools stays at the top of each
indexing page and wraps onto further lines.

**Find a setting** matches page names and setting names, such as Bing
verification code or Excluded paths. A setting result names its page; choosing
it opens that page and focuses its field when it has one. Escape clears the
search.

Settings pages share one action bar. The restore action, such as **Restore
inherited** or **Restore defaults**, sits at the left and always asks for
confirmation. The status, **Discard changes** and the page's save sit at the
right; both stay disabled while nothing is unsaved, and Discard never writes.
While unavailable they stay focusable and do nothing when pressed, so keyboard
focus stays on Discard after discarding and on the save while it runs.
Restore stays disabled while nothing is stored to restore.

Unsaved edits stay when you open another workspace page and come back, on
every settings page. Nothing is saved or discarded by moving between pages;
reloading or leaving the SEO admin page drops unsaved edits.

In Feature controls, a module saved on shows **Open** for its page: Schema,
Sitemaps, Redirects & 404s for the 404 Monitor, or the Work queue's image
checks for Image alt checks. The module list is marked **Save to apply**;
**Automatic & bulk analysis** and **Publisher schema & Local SEO** are marked
**Saves immediately**. **Save modules** and **Restore inherited** apply only if
the module settings have not changed since the page loaded them; otherwise
nothing is written and your switches stay until you choose **Reload latest**.
If the result of a save is unknown, for example after a lost connection,
Search & social, Website, Indexing rules, Sitemaps and Feature controls say the
save was not confirmed, keep your changes and accept no further save until
the saved state is read again: **Reload saved settings** on the first three,
**Reload latest** on Sitemaps and Feature controls. Your changes, the lock and
the page stay while that read runs and when it fails; a failed read is
reported on the page, so you can try again. On
Sitemaps and Feature controls, an unchanged stored revision means the save did
not land and your changes stay for another **Save**; otherwise the stored
choices replace them.

In Templates, choose a content type from the list beside the fields, or from a
menu when the form is narrow or there are more than four types. A type with
unsaved edits reads (edited) and keeps its draft when you switch. A variable
button inserts its `{{variable}}` at the cursor in the template field used
last. After the preview resolves, each field shows an example of its value.

Navigation, setting search results and the controls, states, notes and help of
Indexing rules, including its taxonomy archive list, follow the EmDash admin
language in English, Turkish and Dutch, with an English fallback. On Indexing
rules, validation messages, error details and the plugin overlap notice stay in
English. This first translation scope does not cover other screens, such as
Sitemaps, or stored analysis messages. The content entry's language remains
independent.

Content health keeps analysis controls and warnings visible. While Automatic &
bulk analysis is paused or awaits review, it shows **Enable analysis to scan
content** above the scan options with **Open Feature controls**; that button
only opens Feature controls, where you review resource use and enable analysis.
Saved results stay listed, and manual entry analysis in the editor stays
available. Expand **How analysis works** for detailed scope and continuation
guidance. Scans run only
while the content panel stays open; each selected-count run starts at the first
match, including entries whose saved scores can be reused.

The Content health table lists up to 50 recent saved scores, not the full
inventory, and every listed row shows its saved score. Each time the table opens
it checks the 10 most recent rows of the selected content type, and an entry
opened from a link, against their current saved content, with read-only reads
and no analysis or writes. A row found current shows its band, such as
**Good**; a row whose inputs changed reads **Analysis needs refreshing** with its
last score; the other rows read **Saved analysis** with their saved score. A
status line says while the check runs, or that it could not run, in which case
the saved scores are shown. Results without a number, such as **Too little text
to score**, results from an earlier analyzer and results saved under earlier
settings are not listed; open the entry to see them. The **Saved score
average** on the Overview page is the average of these saved scores.

## Image alt checks

In **Feature controls**, save the Image alt checks setting with **Save modules**,
then reanalyze the relevant content. Existing saved results become stale; saving
the setting does not start a scan or update image fields.

The check finds missing alt attributes on images in the saved body. Image
fields such as the featured image are not checked, because EmDash's picker
stores an empty alt when the media item has none. Empty alt text on a body
image may be intentional for a decorative image and remains a review item.
It does not assess descriptive accuracy or visual quality. Use EmDash's existing
media and content editors for alt text, captions and tooltip text.

## Overview

Follow **Next step** to the relevant setting or content workflow, or use the
**Open** button beside a setup check. **Saved content results** summarize a
limited sample of recent saved analyses. They do not measure the whole site or
prove an entry is up to date; open that entry to review its analysis. The
sample leaves out results without a number and results from an earlier
analyzer. **Need attention** counts entries with Failed or Partly met checks,
not suggestions.

**Setup details** starts open with its checks; **About these results** starts
collapsed. The setup score describes configuration separately from content
scores. Checks show their snapshot time; refresh after updating site or
publisher details.
**Refresh overview** reloads the bounded summary; it does not run analysis, enable features or
submit URLs. Opening Overview or expanding details does not start that work.

## Connect the site's templates

The plugin contributes metadata through EmDash's page hooks. The site must
already render `EmDashHead` from `emdash/ui` with the correct page and content
context. Pages that omit that component do not receive the plugin's head
output. Preserve the site's existing body hook components as well.

**The theme owns the document `<title>`.** In EmDash 1.3.0, `EmDashHead`
renders metadata but no `<title>` element, and Shipit SEO does not add one.
A template that writes the entry's own title into `<title>` ignores the saved
native SEO title. Keep one `<title>` element and render the saved SEO title
there with the theme's fallback, for example from `getSeoMeta()` in `emdash`.
A saved native SEO title or a title shown in the search preview does not prove
that the public HTML title changed. Inspect the actual layout and verify its
rendered title after saving. Do not add an unsupported `renderTitle` option to
`EmDashHead`.

Shipit title templates remain suggestions for previews and analysis. They can
also supply social titles when the social title template is empty; this beta
does not automatically apply those templates to the theme's `<title>`.
Previews are approximate. In the content editor, **Edit snippet** under the
search preview opens **Edit SEO** on its General tab. Edit the native SEO title
and meta description, preview the changes and choose **Save SEO fields** in the
dialog footer. Blank fields inherit their fallback. The **Social** and
**Schema** buttons under the preview open the same dialog on those tabs. The
dialog saves EmDash's native SEO fields separately from the post's draft; see
[SEO saves](#seo-saves).

Under a filled SEO title or meta description, a live estimate reads **Fits
phone and desktop (estimate)** or names where the phone or desktop preview may
cut the text. For the same text, it matches the Title fit and Description fit
checks. The character count names the input limit once the text reaches 90% of
it; the Social fields count the same way. The previews emphasize the primary
focus keyword in the description.

The native **Settings > SEO** panel remains available. Popup fields require
confirmed native values and ownership; a field shadowed by legacy data must be
edited in its current owner, and its hint names **Settings > Migration**. The resolved preview URL is separate from the
checked slug and canonical editing control. Use field-specific Review guidance
for shared templates, legacy ownership and URL limits.

Title and description fit are estimates from Shipit's preview widths, about
340 px on phones and 540 px on desktop. Google sets no title or description
length limit. It [shortens titles as needed and may show a different title](https://developers.google.com/search/docs/appearance/title-link),
and [truncates snippets to fit the device or builds them from page text](https://developers.google.com/search/docs/appearance/snippet).
Fit checks name the device and the words where the text may be cut. They
measure the resolved text, including what a Shipit template adds, such as the
site name in a title, and leave out text the theme adds when it renders the
page. They are Shipit guidance, not a character limit. A description generated
from the body text gets a suggestion to write one instead of a fit estimate.
The search preview can show the publication date before the description; the
preview, the live estimate and the Description fit check all measure the
description after that date. A cut falls at the last whole word when one is
near; a single long word is cut where it overflows.
The phone card allows two title lines and three description lines at its fixed
preview width; the desktop card allows one title line and two description lines.
The sidebar shows the phone preview, reflowed at readable sizes; the Edit SEO
dialog shows both devices. Where the dialog is narrower than the device card,
the card reflows with a short note instead of scrolling, keeping the device's
cut. Preview clipping never changes the saved description.
The **Social** tab shows the share preview first and previews local title,
description and selected-image edits. The dialog footer offers **Save social
text** for the sharing text and **Save SEO fields** for native title,
description or image changes; these are separate saves, and only the native
save is primary when both have changes. Blank social text inherits available
saved sharing text. The image uses a centered crop inside the estimated card;
cropping the preview does not change the asset.

Choose or replace the native sharing image in the **Sharing image** card, which
suggests a landscape image such as 1200 x 630 px. **Clear custom image**
removes that entry override without deleting the media asset. Before saving,
the card previews the image the clear reveals, the featured image or the site
fallback, marked as unsaved; clearing does not mean hiding all images. Sharing images use a saved legacy Shipit image override first, then
the native SEO image, a supported saved featured image and finally the site
fallback. A local image selection can preview before saving; the URL continues
to use last-loaded page data.

## Taxonomy archive indexing

In **Indexing rules**, **Taxonomy archives** offers **Index** or **Noindex** for
each category, tag or custom taxonomy, beside its saved state. **Noindex** adds
`noindex` to that taxonomy's archive pages; **Set all to Noindex** and **Set all
to Index** change every listed taxonomy, and Set all to Noindex changes nothing
when the result would pass the limit of 100 archive rules. The choice applies
to all terms in that taxonomy. Archive rules never add noindex to the entries
that carry these terms or change their sitemap membership; entries follow their
content type rule and their own setting. Site-wide noindex still takes
precedence: while it is chosen, the archive rows are read-only and keep their
choices, as described under [Site-wide indexing](#site-wide-indexing). Save and
discard use the same Indexing form. An omitted policy preserves older settings;
setting every archive to Index again explicitly removes these archive
restrictions.

EmDash 1.3 themes create their own archive pages. Connect each existing archive
template explicitly; the plugin does not guess archive URLs or create routes.
After resolving the real term, wrap its custom page context:

```astro
---
import { taxonomyArchivePage } from "@shipitseo/emdash-plugin-seo/taxonomy-archives";
// term and archiveContext come from this theme's existing archive route.
const page = taxonomyArchivePage(archiveContext, term.name);
---
<EmDashHead page={page} />
```

`archiveContext` must be a custom `createPublicPageContext()` result without a
content entry. `term.name` is the exact taxonomy name. Keep the existing title,
canonical, content and template structure. Unconnected templates receive no
archive rule; saving a choice does not verify a theme's live output. Check the
rendered HTML after integration. Shipit's content sitemap has no archive URLs;
an independently owned archive sitemap needs the same exclusions from its owner.
Noindex needs crawler access to the page; this control does not edit robots.txt.

## Local SEO and sharing defaults

Open **Local SEO** for the publisher steps: 1 Identity, 2 Contact, 3 Social,
4 Address and area, 5 Location and hours and 6 Review and save. With a draft,
each step shows a done or needs-attention marker from the same checks the save
uses. Steps 1 to 5 offer **Previous**, **Discard changes** and **Next**; Review
offers the save, and its **Status and entity** section holds turning the
publisher off or on and entity changes. Enter in a field opens Review before
anything is saved.

The Identity step chooses Person, Organization or Local business and suggests
a square logo of at least 112 x 112 px. Contact holds phone and email;
**Social** holds the full official profile URLs used as sameAs. For a person,
organization-only fields such as the address, service area, hours and price
range are hidden; the draft keeps their values if you switch back.

The Identity step starts with a summary of the saved website name and
production URL. **Edit website** opens the Website form, which saves only those
site settings with **Save website settings**; **Back to business identity**
returns with the identity draft kept. Website and publisher details have
separate save controls. Existing publisher details are kept when starting
setup, and nothing changes until an explicit save.

Changing between a person and an organization requires review of the entity ID
change. Custom-schema references are not rewritten. Organization and Local
business share an organization identity; changing between them keeps its ID.
Navigation keeps local drafts; save each form through its own controls.

Manage automatic publisher output in **Feature controls**. Changing it saves
immediately, independently of Website settings and the business identity form.

Use **Search & social** for the fallback sharing image and optional X card
attribution. Full social and review profile URLs belong to the publisher;
the X field holds only its @handle. The image card is a fallback preview:
entry-specific images and EmDash defaults can still apply.

## Site-wide indexing

Use **Indexing > Indexing rules** and choose **Index** or **Noindex** under
**Site-wide** to set Shipit's site-wide noindex preference. It has an
independent draft: saving sharing defaults or Website settings does not save a
pending indexing change. Discard changes clears only the indexing draft.

Each site-wide, content type and taxonomy archive rule shows its saved state,
**Index** or **Noindex** with the rule that sets it. A choice that is not saved
yet appears on a second line as **After saving** with an **Unsaved** tag, so
the first line always describes the saved settings as last read. After a save
whose result is unknown, the tag reads **Save not confirmed** until **Reload
saved settings** reads them again. While the draft has
site-wide **Noindex**, a note says that it overrides the rules below, and the
content type and taxonomy archive rows show their own rule read-only as **Own
rule kept**. Those choices are not changed: they apply again when site-wide is
set back to **Index**. **How these rules work**, closed by default, explains the
order of the rules, what they do to a sitemap served by Shipit and whether
Shipit serves this site's sitemap.

With Noindex, supported pages receive noindex, nofollow metadata and a sitemap
served by Shipit lists no URLs. Where no Shipit rule applies, a theme's own
robots value that already contains noindex, such as `noindex, follow`, is kept. Choosing Index removes this plugin preference;
core entry settings, other output and search engines can still restrict indexing.
Robots.txt is configured separately. Sitemap exclusions control inclusion only
and do not emit noindex. Content type rules are described below. Taxonomy
archive rules require the explicit theme integration described above.

A legacy Shipit override that remains with its own robots value replaces the
theme's robots value on that page; review remaining overrides in
**Settings > Migration**. While the stored SEO settings cannot be read, Shipit
adds no metadata to pages, so its site-wide, content type and taxonomy archive
noindex rules do not apply, and a sitemap served by Shipit answers 503. The
entry's own core noindex still applies. Saving is off while the record is
invalid. If it stays invalid after a reload, stop site writers, take a
consistent backup and restore the settings from a verified snapshot as in
[Recover a failed update](UPGRADE.md#recover-a-failed-update); do not edit or
delete the record by hand.

## Content type indexing

In **Indexing rules**, **Content types** lists each public content type,
custom types included, with its saved state and an **Index** or **Noindex**
choice; **Edit in Sitemaps** opens the Sitemaps page. Choosing **Noindex** for a
type and saving the Indexing rules adds noindex, nofollow metadata to every
entry of that type. While the rule is on, Shipit's sitemap index lists no file
for the type and the type's own sitemap file answers 404. Its saved sitemap
choice is kept and marked **Noindex rule** on the Sitemaps page. **Index** only
means that the type adds no noindex; an entry can still set its own.

**How these rules work** shows the order: site-wide noindex, then the content
type rule, then the entry's own noindex. Each one only adds noindex. An entry
of a ruled type cannot opt back in, because EmDash's entry noindex setting is
an on or off choice that can only add noindex. The entry's Advanced tab shows
the inherited rule with a link to Indexing rules.

Automatic IndexNow submission skips entries of a ruled type; the IndexNow page
marks the type **Noindex rule** and keeps its saved choice. Manual submission
leaves out each URL whose address matches the URL pattern of a ruled type and
lists those URLs in the result. Matching uses the address shape, so a pattern
made only of placeholders, such as `/{slug}`, also covers other pages of that
shape. While the rule or the content types cannot be read, nothing is left out.
Internal link suggestions count a target of a ruled type as excluded from
search. The checklist names the content type rule in its indexing condition,
which does not change the score. Saved analyses of the affected type need
refreshing after its rule changes; other types keep theirs.

The rule starts empty. A rule for a content type that no longer exists stays
listed by name until you remove it. **Restore inherited** on Search & social
or Website keeps the content type and taxonomy archive rules. Configuration
export includes the rule; importing a bundle without it keeps the current
rules, and an import that adds a restriction shows a warning.

## Indexing tools

**Sitemaps** shows the sitemap index link above its content types, and each
listed type shows its sitemap file links. A type's count, such as "1 file from
16 published entries", counts every published entry; the file itself leaves
out entries marked noindex, excluded paths and entries whose canonical URL
points elsewhere. **Explore sitemap** groups search and status filters in a
compact toolbar above the URL table. The rows-per-page choice sits with the
result count below the table. File selection and its navigation controls
appear only when more than one file is available. Search matches
a URL, path or entry ID within the selected file; Listed and Left out filters
use that same file, with 25 or 50 rows per table page. File counts describe
published candidates; the Listed and Left out totals describe only the selected
file. A changed file requires refreshing the first table page before continuing.
The public XML file size and inclusion rules stay unchanged.

**Crawl diagnostics > Content graph** starts only when you choose **Analyze
sample**. It inspects at most 1,000 content records across all content types
and 20,000 editor links, with document traversal limits. This is a bounded
content sample, not a full-site audit. The report names limited coverage;
an unresolved destination may simply be outside the sample, and an unlinked
entry still needs a check on the rendered site. Each finding list retains at
most 250 rows, supports search and content-type filtering, and shows 25 rows
at a time. Totals and omitted findings are reported separately. Opening the
page does not start an analysis or a network crawl.

**Rendered crawl** is a separate manual check with its own request limits.
A large site's complete crawl needs a dedicated crawl workflow; neither a
sample with no findings nor a reached limit establishes that the whole site
has no issues.

**Robots.txt** edits the same text as
EmDash Settings > SEO; the later save is kept. The **llms.txt** output switch
in its panel header applies immediately and reads Output on or Output off;
text changes need **Save**.

**Redirects & 404s** opens on **Redirect rules**, with **404 activity** and
**Forwarded paths** tabs. Each 404 activity row, in Recorded paths and Top by
hits, offers **Create redirect**, which opens **New redirect** with that path
as the source. An unconfirmed earlier redirect save opens for review instead
of being replaced. Saving still uses the redirect form's checks.

## Canonical and language status

On supported native EmDash targets, change the canonical URL or indexing in
EmDash's own SEO panel. The editor's **Advanced** tab groups its controls by
save scope. **Saved with the entry** shows their saved summaries, with notes
for site-wide noindex and an inherited content type rule. **Applies to the live
page now** holds Nofollow links and the advanced robots directives, which save
as soon as they change. Each change reads the saved directives again just
before it writes, so a change saved elsewhere in the meantime is kept. These
saves have no revision check: when two people change them at the same moment,
the later save wins. On the public page, the directives are added to the
theme's own robots value, so a theme `noindex` stays; where a Shipit noindex
rule, the entry's own noindex or a legacy override's robots value applies,
they are added to that value instead. Popup authoring is limited to native title, description and image.
If the native panel is absent, enable SEO for that content type in
**Content Types**; code-defined content types require the matching
configuration change. Shipit does not enable it automatically. Native SEO
changes save separately from the content draft and can affect the live page
immediately. Confirm the field save and public result.
Review Metadata ownership if a legacy Shipit
override remains; it can take precedence over the core field.

The entry preview does not check translation groups. Advanced labels that
result **Not checked in this preview**; it does not mean a translation problem
or add a score penalty. This reduced preview does not establish a complete
hreflang audit. Real diagnostic warnings and errors remain visible.

## Schema for a post or page

In the content editor, the **Schema** button under the search preview opens
**Edit SEO** on its Schema tab. **Schema in use** comes first: one row for each
of this entry's schemas and each other graph Shipit's preview adds, with a
badge for its source (This entry, Content type default, Shared or Site). Only
the entry's own rows can be edited or removed there, with an inline removal
confirmation; other rows link to **Manage in Schema**. Each row can show its
resolved JSON-LD. The per-entry default switches and shared schemas that add
nothing here sit in the collapsed **Defaults for this entry**. A default switch
saves as soon as it changes and reads the entry's saved choices again just
before it writes; like the Advanced directives, the later of two simultaneous
changes wins. While it saves, the section stays open and keyboard focus stays on
the switch. With Schema output off, only the entry's own schemas are listed.

**Add schema** offers field-based forms for Article, BlogPosting, WebPage,
Service and FAQ; **Search schema types** filters them, and Enter picks the
first match.
Choose Resolved SEO title, Resolved meta description or Canonical URL where
offered, or enter an explicit value. Title and description variables include
SEO overrides and templates, so they can differ from the content fields.
The optional page URL starts empty; choose Canonical URL only when needed. Enter FAQ questions and answers from the visible content.
These forms do not invent business, author, review or pricing information.

The entry list uses scoped inventory reads. Opening **Edit** or **Delete** reads
one selected record and its revision; listing twenty schemas does not add
twenty versioned reads. A failed or changed record must be reviewed before it
can be edited or removed. These actions still use host CPU and database reads.

The JSON editor remains available for other types and richer existing markup.
Guided editing is available only when every property can be preserved. Changing
the editing view must not drop custom JSON properties.

Additional entry schemas stay separate from defaults, shared schemas and other
saved entry schemas. A matching type in Shipit's saved output shows a notice:
adding it may create another graph, without replacing or merging existing graphs.
**Show current output** opens a read-only view without changing the draft or
its confirmation step. Theme and other plugin markup are outside this notice.

**Preview** checks this unsaved form's predicted contribution; it does not verify
the whole public page or Google eligibility. For a published entry, Canonical URL can use the public
route registered with EmDash. An explicit entry canonical takes precedence;
a theme canonical override can differ from the route prediction. If the route
cannot be resolved, enter an explicit URL or omit that variable. Draft-only
inferred paths are not used for this prediction. Local field and JSON checks
are separate from that preview.

**Save schema** saves independently of the content draft. An enabled save can
change an already published page immediately; a draft entry must be published
before its schema reaches a public page. Keep the current form through conflict
or unknown-result review. Reloading or leaving the entry discards local state.

## Schema workspace

Open **Schema** for its **Schema map**, **Custom schemas**, **Library** and
**Defaults** tabs. Use **Add schema** to open the builder in Custom schemas,
choose a guided recipe or the raw JSON-LD editor, select its scope and
explicitly save. The recipe list has a **Search schema types** field, a
one-line description per type and the number of saved custom schemas using it;
the Up and Down arrow keys and Enter choose a type. When the chosen type is already in use, the builder lists the
matching saved custom schemas and enabled defaults. That notice changes
nothing; saving still adds a separate record. The draft preview checks input;
it does not inspect a public page or prove eligibility for a rich result. An
enabled saved schema contributes only when Schema output is on and the page
matches its scope.

Use **Defaults** for content-type mappings and built-in schema choices.
Unsaved choices are selections, not active output. Review **When this applies**
for the required page context and data. Each form keeps its own save controls.

Guided, raw and preset drafts survive navigation between SEO workspace views
and sections. Closing the builder keeps its draft; **Resume draft** returns to
it. Replacing or discarding changed input requires review. Refreshing the page
or leaving the workspace can discard this local state. Save before doing so.

The **Schema map** groups the last read configuration by publisher, built-in
schemas, content-type defaults and scoped custom schemas. Its statuses describe
configuration, not markup emitted on every page. Entry overrides, conflicts
and required data still affect output. Incomplete inventories are labelled.

The **Library** tab, also reached as Schema library, stores reusable templates
without publishing them; a template is never added to a page by itself.
Choose a type to edit supported fields and page variables, or use Advanced
JSON-LD for other structures. **Use template** opens the builder in place with
an independent copy: choose its content type, all pages or one entry, review
and enable the copy, then explicitly save. Back returns to Library, with focus
on that template's **Use template** button, or on the **Schema library**
heading when the template is no longer listed or cannot be used. Copies
start disabled with no application scope selected.
They add a custom contribution rather than replacing a built-in default.
Editing or deleting a library template leaves saved copies unchanged. You can
also choose a template inside an exact entry's SEO **Schema** tab and save
that entry-owned copy; a copy made there starts with **Include in page
output** on. Templates are created only in Library, not from an entry's form.
Copies do not record which template they came from, so the library cannot
list where a template is used.

If Library reports **The stored library is invalid**, nothing is overwritten
while it stays invalid: saving and deleting templates are off and no template
can be copied, in Library or in an entry's Schema tab. Schemas already copied
from templates are separate records and keep working. Reload the library
first; if it stays invalid, stop site writers, take a consistent backup and
restore the library from a verified snapshot as in
[Recover a failed update](UPGRADE.md#recover-a-failed-update). Do not edit or
delete the library record by hand.

If Library cannot be read again after its templates were shown, the list, your
form and a notice that a save or deletion was not confirmed stay on screen,
with a notice about the failed read. Saving, new templates and template
actions stay off until a later read succeeds; **Try again** reads the library
again.

Once the templates have been shown, when the Library control you were using
disappears or turns off, for example **Try again** while its read runs or a
**Save not confirmed** notice that a later read settles while the form stays
open, focus moves to the
**Schema library** heading once no read or request is running. When a save,
or a read that settles a save that was not confirmed, closes the form, focus
moves to **New template**. Focus you placed on another control while it ran
stays there.

Custom-schema edits and deletes use the version loaded when you opened the
record. If another administrator changes it, your old form is refused and its
draft stays available. Review the current saved record before deliberately
using its values or keeping your draft for another explicit save. Built-in
choices use the same revision check; a refresh alone does not authorize
replacing a newer saved selection. Invalid stored choices require an explicit
repair decision.

After **Change not confirmed**, keep the draft and wait for the request to
settle. Read the exact target without retrying, then review what is stored now.
That read does not establish which earlier request completed. A timed-out save
may still finish. The draft retains its create identifier while this workspace
stays mounted, so a repeated create cannot overwrite that identifier. Reloading
or leaving the workspace discards local recovery state; inspect existing saved
records before starting another create. These guards do not make a multi-record
import transactional. An interrupted import can leave partial changes; recovery
preserves newer edits and reports anything it could not restore.

## SEO saves

**Save SEO fields** appears in the Edit SEO footer on every tab while a native
title, description or image differs from its saved value, with a **Changed:**
line naming those fields. It updates only the changed fields for the current
entry and locale, checks the observed entry revision and reads the saved
values back before confirming **SEO values saved and checked.** That
confirmation stays shown until the next edit. **Discard SEO edits** returns the
fields to their saved values. Body content, canonical, noindex and other
native fields are preserved.

EmDash stores SEO fields beside the entry, outside its drafts. On a published
entry, **Save SEO fields** updates the live page at once, even while other
changes are still a draft; on an unpublished entry, visitors see the fields
once it is published. The footer names which applies. Save other post changes
first: the popup cannot synchronize an unsaved content draft with its separate
SEO write, and EmDash asks you to confirm unsaved post changes after another
save.
When EmDash saves the entry while the popup is open, for example by autosave,
the popup stays open with your edits. If the saved SEO fields did not change,
the next Save SEO fields uses the newer entry version; if they changed, the
saved values are shown for review before another save. During that review,
fields you did not edit show the reviewed saved values, as the search preview
does.

If another editor holds the entry in EmDash, the save is refused before
anything is written. Your edits are kept, and the notice asks you to take over
the entry in EmDash before saving again; this is not a review of changed
values. A save EmDash refuses for another reason, for example for an account
without access, also writes nothing and keeps your edits.

After a conflict or uncertain result, your SEO edits remain available. Use
**Check saved SEO fields**, then choose **Keep my edits** or **Use saved
values** after reviewing the current values. The preview refreshes to the
reviewed values before the fields can be edited again, and a kept edit saves
as a fresh guarded write on the reviewed version. If the check finds the saved
fields unchanged after an interrupted save, the save did not complete: **Save
SEO fields** and **Discard SEO edits** are available again, and nothing is
retried on its own.

Leaving the entry inside the admin keeps unsaved popup edits for this browser
tab. Returning to the entry says so, and opening Edit SEO checks them against
the saved values first, with the review when those changed. Reloading or
closing the tab asks before leaving while edits are unsaved.
When the entry was saved elsewhere since EmDash last loaded it, for example in
another tab, the panel finds the newer saved version, asks EmDash to read the
entry again once, as EmDash does when its window regains focus, and then shows
the preview and checks for that version. Unsaved post changes stay in the
form. While that version is read the preview says **Updating preview...**, and
while the checks' inputs load the panel says **Loading checks...**. A failed
read is not repeated on its own: **Retry preview** and **Retry checks** each
send one request.
The plugin does not retry an uncertain write or reload the content editor.
EmDash cannot let the popup update its unsaved post draft. When you save SEO
fields while the post has unsaved edits, EmDash's next save of the post,
manual or automatic, shows its own banner: "This entry changed somewhere else
after you opened it." with a **Save anyway** button. **Save anyway** keeps your
post text and the saved SEO values, because EmDash does not submit SEO fields
with it. Reloading the page instead discards the unsaved post text. Save the
post first to avoid the banner.

## Social saves

The Social card updates locally while you edit the title and description;
typing and switching platforms do not save or run analysis. The 300/1000 input
caps limit stored text, not how much a platform displays. The card estimates
line fitting and keeps the full metadata accessible. Actual layouts vary by platform,
device and cached metadata; the preview is not a platform rendering guarantee.

The card stays available when a metadata refresh or save confirmation fails.
Its status distinguishes unsaved text, saved sharing values and fields that
could not be read. A confirmed nonempty override appears without
waiting for a preview refresh. Native image edits use the separate **Save SEO
fields** save; the URL still uses saved page data.

A confirmed Social save acknowledges the stored values independently of the
resolved preview. A failed preview refresh does not undo that acknowledgement.
Save confirmation and saved-value checks wait up to fifteen seconds locally.
A save may still finish on the server after a timeout; it is never retried
automatically.

If the save result is unknown, use **Check saved social text**. It reads the
current record without retrying the write. Matching values establish what is
currently saved, without identifying which request wrote them. After a conflict or a
readback with different values, review the stored values and deliberately use
them as the new baseline before saving your local edits again.

On native EmDash 1.3, Social edits, the Customize choice and any pending save,
saved-value check or unresolved review survive tab and desktop/mobile changes
within the same editor form, account, entry and locale. Another save stays
blocked until the current attempt is resolved. **Close** discards ordinary
unsaved edits but keeps unresolved results and reviews with their drafts.

Changing the entry, locale or editor form, signing out, changing account or
permissions, losing confirmed sign-in information, or reloading clears local
state. If the form or account cannot be identified, state lasts only until the
current panel is recreated. A session replaced elsewhere may remain undetected
while EmDash reports the same account.

Clearing both fields removes the entry's canonical, ID-based Social override.
An older override stored under its slug can still supply Social values.
The card leaves affected text unresolved until a metadata read after the
confirmed clear, so it cannot mistake an older fallback for the new result.

## Features

| Area | What this beta provides |
| --- | --- |
| Search and social metadata | Canonical and social URLs, descriptions, Open Graph/X values, site defaults and content-type templates. EmDash owns native per-entry SEO fields. |
| Structured data | Presets, publisher/business identity, validated custom JSON-LD, entry schemas and a reusable schema library. The host safely renders data returned by the plugin. |
| Content checks | Saved-entry analysis, freshness explanations, bounded score history, content health and explicit scoped scans. Suggestions and scores do not guarantee rankings. |
| Internal links | Contextual suggestions with an anchor, destination and reason. Add links through the native editor; there is no one-click draft insertion. |
| Public files | Sitemap choices, a core-owned robots.txt editor and optional manually authored llms.txt. Existing route ownership is respected. |
| Redirects and 404s | Read retained core 404 records, start a redirect from a 404 row and create/edit exact-path 301/302 redirects. EmDash owns their storage and serving. |
| Site verification | Manage core Google/Bing codes and custom verification meta tags for other services. Saving a code does not verify the account with the provider. |
| IndexNow | Public key setup, manual and selected content-event submission, bounded queue/retry handling and history. Enable it explicitly on a reachable public host. |
| Configuration | Selected configuration export/import with a preview. This is not a complete site backup. |

## Site verification

Open **Site verification**. Use the Google or Bing card for those services;
under each code, the tag EmDash adds is shown as you type. **Save Google and
Bing codes** saves only those codes in EmDash's SEO settings, which EmDash
Settings > SEO also edits; the later save is kept. For another service, choose
**Add tag** under **Custom verification tags** and copy the tag's `name` and
`content` values into the two fields, then use **Save custom tags**, which
saves only the custom tags. **Discard changes** beside **Save Google and Bing
codes** returns both codes to the stored values without writing. Use Reload to
check the stored values. Remove a row and save to stop adding it.

Custom tags are empty until configured. You can save up to 10 tags, with names
up to 128 characters and codes up to 1024 characters, within an 8 KiB total
limit. Names are normalized to lower case. Duplicate names, markup and names
reserved for existing SEO or browser controls are refused. This is a
verification-code form; it accepts no scripts or arbitrary head HTML.

Saved tags are added to pages that render EmDashHead. Check the anonymous
home page source, then finish verification in the service's own tool. A theme
or another plugin can also output a tag; this form cannot inspect every other
owner. Saved is a storage result, not proof of public placement or provider
acceptance. The plugin makes no automatic request to a verification provider.
Custom tags reuse the existing public settings read.

If a save cannot be confirmed, use **Check saved tags** before retrying. Your
draft stays available for comparison. Configuration export includes custom
tags; importing an older file without them preserves the target site's tags.
An explicit empty list removes them. Keep a full site backup for recovery.

## Defaults and first checks

Installing does not seed content, start a site-wide scan or enable IndexNow.
It leaves existing plugin preferences in place. With no saved indexing
preference, Shipit SEO adds no site-wide noindex directive; entry, theme and
other owners' directives still apply. To keep a site out of search, configure
and verify that restriction explicitly. A plugin setting is not access control.

Check one representative published entry and each relevant locale:

1. Confirm that **SHIPIT SEO**, or the configured name, opens and the native
   editor keeps its saved fields after a reload.
2. Inspect anonymous HTML for one canonical URL, the intended description and
   social tags, the theme's document title and valid JSON-LD. Confirm the
   entry's publication/noindex rules still apply.
3. Review `/sitemap.xml`, `/robots.txt` and, if enabled, `/llms.txt`. Compare
   the served result with the admin's ownership message. A competing static
   file, route or integration can keep ownership of an address. If the build
   cannot inspect a relevant directory, ownership stays unknown: Shipit leaves
   the sitemap route alone and makes robots editing unavailable. Correct the
   filesystem access and restart or rebuild to inspect ownership again.
4. Run the site's existing type checks and production build. Check the admin
   and a public page at narrow and desktop widths.

Keep members-only and password-protected content out of sitemap selections;
published status alone does not prove anonymous access.

Do not treat a preview, a successful save or a score as proof of public output.

## Basic editor checks

Open a saved entry to use focus keywords, search and social previews, and the
SEO checklist. These tools do not require enabling automatic analysis.
Basic checks run in your browser using the saved snapshot already read for the
preview; they do not start a scan or write score history. Saving keywords stores
only that entry's keyword profile.

Keyword changes save automatically after a short pause; check their save status
before leaving. A failed keyword save is not retried on its own; its status
offers **Retry**. Local keyword changes can update the checks before that
profile is saved. A chip follows the checklist rows for its keyword: the primary chip's
color and count follow **Focus keyword in title**, **Focus keyword in
description** and **Focus keyword in body text**, and a secondary chip follows
**Secondary keywords**. The slug is not counted. A chip shows no result until
those checks have run for that keyword. Chips report phrase matches, not keyword
difficulty, relevance or the whole entry's score.

Basic checks show a score automatically when the saved evidence can be checked.
A saved assessment profile takes priority. Otherwise, Posts use Article checks;
Pages and custom content types use General content checks. You can change this
choice in Analysis options. The default is used only in the browser: it does
not save a profile or enable server analysis. Schema output does not select the
assessment profile.
Unsaved content edits and content added by the site template are outside these
checks. Unavailable evidence stays unassessed. Browser checks take the Image alt
checks, nosnippet and generated-description settings from the entry preview,
which reads them the same way as server analysis. Browser results are separate from
stored scores, list badges and history; they do not verify the served page. If
native SEO fields are off, body and keyword checks remain available; metadata
stays unassessed and no numeric score is shown.

## Saved-content analysis

Choose **Article** or **General content** as the assessment profile for each
content type before requesting server analysis. In the editor, the closed
**Analysis options** disclosure below the checklist holds this choice under
Analysis settings, with Saved analysis & history and the Temporary session
check. Saving a profile is a separate, explicit save; **Save analysis** does not
choose or save a profile for you. The profile controls analysis rules
independently of schema output. Changing a profile does not change its
published JSON-LD or erase earlier results.

Open **Analysis options > Saved analysis & history** and choose **Save analysis**
for a server assessment of that entry's last-saved version. It updates the
current saved score, excluding unsaved edits. This manual action remains
available when automatic analysis is paused or awaiting confirmation; in that
state it adds no score history and preserves earlier history. Opening an
editor or typing a keyword does not run this action.

For automatic save/publication checks, score history and filtered bulk scans,
open **Feature controls**, review the resource-use notice and explicitly enable
the automatic-analysis feature. Earlier enabled preferences remain pending until the
notice is acknowledged. Activation does not start a catch-up scan: choose the
content type, status, locale, taxonomy filters and count, then select **Start
analysis**. Ordinary settings saves and inherited settings restore preserve the
analysis preference; configuration imports require fresh local activation for
these optional operations.

The checklist has four groups: **Basic SEO**, **Additional**, **Search
snippet** and **Content readability**. Each row shows a check name and one
status word, with the check's detail on the next line without opening the row.
A scored check is **Passed**, **Partly met** or **Failed**; advice
is **Suggestion** or **Passed**; a check whose evidence could not be read is
**Not checked**. Rows are ordered Failed, Partly met, Suggestion, Not checked
and Passed, heavier checks first. Open a row for its full detail,
recommendation, evidence and basis. Checks that do not apply, such as image alt
text without body images, collapse into one closed `N not applicable` list.

Each group shows `N issues`, with its suggestions when there are any, or else
`M suggestions`, `K not checked`, **All good** or **Not applicable**. Issues are
Failed and Partly met checks. The header totals are the sums of the group counts.

A Failed, Partly met or Suggestion row with an editor field offers one action
beside its status: **Add keyword**, **Edit title**, **Edit description**,
**Review URL**, **Edit image** or **Open Advanced**. In a narrow panel the
action moves to the end of the row, below the finding, so the name and status
word have the whole first line. **Review URL** shows the
saved URL and where its slug is edited. An action opens the relevant
control; it does not save a field, change a keyword or run analysis. Body text
checks have no action; edit the body in the content editor. If keyword settings
cannot be read, retry before editing; unreadable data is not treated as an
empty profile.

The score is a Shipit checklist score, not a Google score or a ranking
prediction. It describes mechanical checks of saved content, not factual
accuracy, expertise or usefulness. Every threshold is Shipit guidance;
[Google prescribes no minimum or maximum word count](https://developers.google.com/search/docs/fundamentals/seo-starter-guide#things-we-believe-you-shouldnt-focus-on).
Rules marked Google practice follow Google Search Central guidance. The score
is the share of available weighted points that the evaluated scored checks
earn: a Passed check earns its full weight, a Partly met check 35% and a Failed
check nothing. Suggestions, Not checked and not-applicable checks carry no
weight. Article content has up to 89 points and General content up to 79.

| Check | Points | Rule |
| --- | --- | --- |
| Title, Description | 14 each | A resolved value is present (Google practice) |
| Public URL | 8 | A valid public HTTP(S) URL |
| Body text length | 10, Article only | 600 words or more pass, 300 to 599 are partly met, fewer fail |
| Focus keyword in title, description, body text | 4, 3, 3 | The primary phrase appears (Google practice) |
| Social image | 8 | An entry or site image is set; otherwise partly met |
| Image alt text | 6 | Every body image has an alt attribute (Google practice) |
| Internal links | 5 | A body link to another page on this site; otherwise an Article fails and General content is partly met |
| Link text | 3 | No empty or generic link labels; otherwise partly met (Google practice) |
| Focus keyword repetition | 4 | Not applicable below 100 known body words; otherwise fails above 3.5% with 3 or more uses |
| Sentence length | 4 | Average of 25 words or fewer; otherwise partly met |
| Paragraph length | 3 | Longest paragraph of 120 words or fewer; otherwise partly met |

Advice adds suggestions without changing the score: a missing focus keyword,
the keyword in the URL, introduction and subheadings, secondary keywords, a
page-specific social image, a featured image for articles, schema, canonical
preference, empty alt text on body images, heading structure (for General
content from 300 words or with headings), the **Search snippet** checks
and General content under 100 words. The URL check notes that changing a
published URL needs a redirect. Image alt text applies only while Image alt
checks are on and the saved body has images.

**Article** content scores body text length, expects an internal link and
suggests a featured image. Its 600-word pass threshold and score limit below
600 words are Shipit calibration, not publishing requirements. An explicitly
selected **General content** profile, suitable for short contact or product
pages, keeps its suggestion under 100 words, partly met result without an
internal link and no featured image check.

**Body text length** counts words in all text extracted from the saved body,
headings included. Words are word segments where the runtime supports them, so
text written without spaces is counted too, and otherwise space-separated.
Browser checks and server analysis use the same extraction for a body saved in
the default `content` field; other body fields show **Not checked** in browser
checks until **Save analysis**. Blocks Shipit cannot
read, such as custom blocks, can only add words: a passing count stands, but a
short count with such blocks is **Not checked**. Body text from the site
template is **Not checked**. Unread body evidence neither passes nor fails.

Some failed checks limit the score. The lowest applicable limit sets the score:

- no title: 49;
- Article body text under 50 words: 40; 50 to 599 words: 70;
- **Focus keyword repetition** failed: 79;
- focus keyword in none of the title, description and body text: 79.

Bands are Shipit guidance and follow the limited score: 80 and above is
**Good**, 50 to 79 **Needs improvement** and under 50 **Poor**.

The number is shown only after choosing a profile and when every weighted
check was evaluated. Suggestions, checks that do not apply and an unset focus
keyword do not hide it. When a weighted check or the body text could not be
read, the score shows a dash and
**Partially checked**. General content under 50 words of body text shows a dash
and **Too little text to score**. A note beside the number names a limit that
lowered it and, without a focus keyword, also reads **No focus keyword**.
The editor, content list badges, notices, overview, history and scans use this
one decision, and dashed results stay out of averages, trends and comparisons.
Passing a small set of applicable checks does not establish a full assessment.
Noindex is reported separately and does not reduce the score.

Focus keywords are optional. Without one, keyword checks do not apply and a
**Focus keyword** suggestion offers **Add keyword**. With one, the title,
description and body text checks look for the literal primary phrase and fail
when it is missing. Secondary keywords feed only the **Secondary keywords**
advice. Keyword checks match a phrase within one saved field, heading or
paragraph, ignoring case, accents and punctuation. Marks that change a word,
such as Thai tone marks, Indic vowel signs and kana voicing marks, are kept, and
Turkish dotted and dotless I match either case. They preserve words split by
inline formatting and do not join separate sources to invent a match. A phrase
in a script written without spaces, such as Japanese or Thai, matches within the
text, and a phrase in another script also matches beside such text. A keyword
made only of symbols has nothing to match and is not used.

**Focus keyword repetition** is not applicable for a known body under 100
words: that sample is too small for this ratio. At 100 words or more, it fails
when the primary phrase appears at least 3 times and its uses exceed 3.5% of
the body word count, including headings. Feedback reports those counts and
the ratio; it does not diagnose spam. The 100-word minimum and 3.5% threshold
are Shipit guidance, not Google requirements.

Sentence length requires at least 60 prose words and three sentence segments.
Headings do not count toward that minimum, and separate paragraphs are
evaluated independently. Paragraph length applies when the body has paragraphs.
Sentence and paragraph thresholds are written for English, the
punctuation-based estimate is approximate and short samples are not evaluated.
The sample minimum is a limit of this check, not a publishing requirement.

The editor header and checklist show the current saved analysis
when it matches the saved version and keywords; otherwise they show the browser
checks. After a reload, the editor confirms a stored result for the saved
version with one read of its inputs before showing it; nothing is analyzed or
written. While inputs reload, the last checks stay shown as **Updating
checks...**. Temporary checks are session results and are not stored in score
history. Brief scope notes explain unavailable checks or limits; the underlying
calculation and earlier records stay unchanged.

**Saved analysis** means the current content has not been checked; Content
health still shows its saved score (see Content health above). **Analysis
needs refreshing** means the saved inputs or analysis version no longer match.
A result saved by an earlier analyzer shows **Earlier analyzer. Analyze
again.** instead of a number, band, meter or comparison, and its rows read
**Earlier result**. The previous result and history are kept. Reopening an
editor or responsive panel may leave a snapshot unverified until you explicitly
analyze saved content again.

**Trends** separates the latest retained current-version observations and daily
averages from **Paired score change**. A pair uses the same entry, analyzer version and
assessment profile: its latest sample in the selected period and its latest
sample before that period, or its first sample in the period if none is older.
The comparison and Recent changes use those same pairs. Equal samples are
stable; one sample alone cannot establish a change. Only snapshots with a
number are averaged or paired; a dashed snapshot stays in history without a
point.

Snapshots saved with an earlier analyzer stay in history but are not averaged
or compared, so trends restart with analyzer 22: the next analysis of each
entry starts its new points. Pair and exclusion counts show the available
coverage. Changes to content, keywords, metadata or the checks that apply can
move a saved score; changed check scope is reported. This is retained history,
not a live site census or evidence of ranking improvement. Older raw records
stay readable; upgrading does not backfill history, reanalyze entries or start
a scan.

The score model uses loaded checks and bounded history. It adds no network
requests, providers, dependencies or visitor-side work. New snapshots keep
compact assessment and check-scope context without copying content or keyword
text into that context.

Manual assessments, enabled save/publication checks and explicit scans use host
CPU and database resources and may affect hosting charges. Pausing analysis in
Feature controls stops automatic checks and scans; deliberate single-entry
analysis and basic editor tools remain available, and saved results/history stay
readable. Returning to a paused scan requires **Resume**.

The analyzer version and the plugin version are part of each saved score's
input identity. After a plugin upgrade, the first automatic save check, scan or
**Save analysis** for each entry analyzes it again once, even when its content is
unchanged. Each of those writes one current score and, when score history is
enabled, one history snapshot. A scan resumed across an analyzer change, such
as the move to analyzer 22, pauses once for a policy change; review it and
choose **Resume** to continue. Entries the run handled before the upgrade keep
their earlier result until analyzed again.

Configuration exports carry the collection profiles, without their storage
revisions or resource-use acknowledgement. Merge combines profile maps; replace
replaces an explicitly supplied map. Older bundles without a profile map keep
local selections. Every successful import requires fresh local activation for
automatic analysis, history and bulk scans.

An unreadable or corrupt saved profile blocks analysis for that type and stops
configuration export/import. Reload can recover a transient read failure. If
storage remains corrupt, pause analysis, stop site writers and take a consistent
backup. Follow [UPGRADE.md](UPGRADE.md) to recover from a matching snapshot whose
restoration has been verified on an isolated copy. Do not edit individual
analysis-profile records without a reviewed, rehearsed repair procedure that
preserves stored revisions and unrelated data. A schema-output change does not
repair an assessment profile.

Application controls and per-operation bounds are not a provider spending cap.
Public metadata and structured data also consume host resources on uncached
requests. Configure account-level billing controls with the hosting provider.

## IndexNow

IndexNow starts off. On a deployed site with the correct HTTPS `site` origin,
**Enable IndexNow** creates a public key, checks `/indexnow-key.txt` on that
origin and enables delivery only after the file matches. An existing file or
route at that address keeps ownership; resolve a conflict before enabling.
The key is intentionally public. The verification file reads that key through
EmDash's local public-route support without making an HTTP request back to the
site. If that support is unavailable, the file returns 503. Custom `fetch` or
non-default `pluginRoute` overrides in `createIndexNowKeyRoute()` are no longer
supported and return 503; the standard wrapper needs no override.

Participating engines such as Bing receive submitted URLs; Google Search is
not an IndexNow participant. Enabling delivery does not enable automatic
submission or submit all existing content. Choose the automatic content types
separately and save them with **Save content types**; key, batch and retry
settings use **Save advanced settings**. Content types with a noindex rule in
Indexing rules are marked **Noindex rule** and are not submitted. Queued, sent
and provider-accepted are different states; none means the URL was indexed.
**Turn off IndexNow** asks for confirmation first, and **Cancel** keeps it on.
Turning it off keeps the key, its settings and operational records; queued and
retrying URLs stop being sent and no new URLs are queued.

Each delivery request has a 10-second local deadline, including the native
host's response buffering. A timeout cannot confirm whether the provider
received the URLs; a retry may submit them again. Existing attempt limits and
delayed retries still apply. This deadline does not cap database time, total
retry usage or the hosting account's bill.

The integration restricts its declared network targets to `api.indexnow.org`
and the configured public hostname. A local key check or controlled transport
test does not establish live provider acceptance. Live provider delivery and
Cloudflare/D1 operation are not verified for this beta.

## Limits

- Host ownership and page context determine which metadata and public files
  are served. The wrapper does not override a competing theme or route.
- Content-type controls list at most 100 public, routable types. Hidden and
  non-routable types are excluded.
- An entry holds at most 20 owned custom schemas; storage holds at most 500
  custom schemas. Entry schemas are limited to 32 KiB, 16 levels and 2,000 values each.
  Legacy workspace schemas retain their separate 100,000-character limit.
  A public request examines at most 500 matching stored schema records; a cap
  can omit output and produces a warning.
- The schema library holds at most 20 templates and 128 KiB in total. Library
  changes do not update copies already saved on entries.
- Content type rules cover at most 100 content types and only add noindex;
  EmDash's entry noindex setting cannot lift a rule for one entry. Manual
  IndexNow submission matches ruled types by URL pattern, so a pattern made
  only of placeholders also covers other pages of that shape.
- Internal-link discovery uses explicit scope and pagination. It does not
  automatically inspect the entire site or edit the entry.
- A scoped score scan runs while its panel is open. Returning to a paused run
  requires Resume. Older results can remain readable but out of date; no
  continuous background scan keeps them current.
- Redirect creation/editing checks can race with changes to other rules;
  revision protection covers the edited rule. Redirects remain subject to
  EmDash's route restrictions.
- A settings or schema save can affect an already published page immediately.
  Read and reconcile an uncertain outcome before trying another write.
- Native SEO saves are separate from the content draft and Social text. Save
  other post changes first and confirm the SEO save before publishing. Use saved
  value checks to resolve an uncertain result; do not reload and lose a draft.
  This beta does not patch the host editor.
- Full multilingual use of the Edit SEO dialog, such as switching the entry's
  locale while it holds edits, is not verified in this release. Save or discard
  popup edits before changing locale.
- Live IndexNow provider delivery is not verified in this release.
- Updating, removing or reinstalling the package with npm is not verified in
  this release; the tested paths use pnpm, as listed in
  [UPGRADE.md](UPGRADE.md#tested-update-paths).
- Social saves check the current canonical record's revision, including when
  its values changed and were later restored. A record created and deleted
  between two observations of absence cannot be distinguished from one that
  remained absent.
- Legacy migration remains unavailable when the host lacks the required
  conditional content-write contract. Installation never performs it.
- Rich results, indexing, provider verification and search rankings are not
  guaranteed by a valid configuration or structured-data graph.

## Upgrade and recovery

Use [UPGRADE.md](UPGRADE.md) for version selection, the update checklist and
recovery. Native npm updates are deliberate dependency changes, not automatic
EmDash plugin-manager updates. Historical tested update paths are listed in
[UPGRADE.md](UPGRADE.md#tested-update-paths); they do not qualify a different
archive. Updating or removing the package with npm is not verified. Moving
from the earlier scoped alpha packages is untested and unsupported;
see [Install](#install).

Before upgrading a real site, gracefully stop all application instances, workers
and schedulers. Use the site's established process to take a consistent
database/uploads backup with its matching package manifest, lockfile and
configuration. Use a SQLite-aware backup that preserves committed WAL data;
copying only the main database file can omit saved changes even after writers
stop. Record the current package versions and verify restoration on an isolated
copy.

Install the new exact plugin version, keep the `shipit-seo` ID and existing
storage, then restart and repeat the first checks. Installing this beta does
not upgrade EmDash or remove existing preferences. If you try the unsupported
alpha transition on an isolated copy, a site that relied on an earlier alpha's
unsaved default noindex must save its intended restriction first; an absent preference in this beta means no plugin-wide
restriction.

The configuration export omits operational and content-owned data, including
IndexNow keys/queue/history, scores, migration records, legacy overrides,
business identity, schema library templates and EmDash entry SEO. Keep the
database backup for those records. Preview any import and keep its separate
pre-import backup.

Apart from removing a stored resource-use acknowledgement from the settings
record, an import writes only the sections its preview lists as changing. A
section without a stored record stays without one when the import leaves it
at its defaults, a template equal to the inherited one keeps inheriting, and
unchanged custom schemas and IndexNow settings are left as they are. The import keeps this site's confirmation of its saved
indexing preference. As its preview states, it does not keep the resource-use
acknowledgement: after every successful import, automatic analysis, history
and bulk scans need fresh local activation.

To roll back a failed installation, stop the site's writers and restore the
previous package manifest, lockfile and configuration. If plugin data was
changed, restore the matching database/uploads snapshot using the tested
recovery process before reopening the site. With SQLite, move the failed
state's database, `-wal` and `-shm` files aside together before putting the
snapshot in place, as [UPGRADE.md](UPGRADE.md#recover-a-failed-update)
describes. Restoring a snapshot discards
writes made after its restore point; account for later content, settings and
upload changes before choosing it. Installing an older package alone does not
undo data changes or EmDash migrations; older alpha readers can interpret newer
indexing settings differently. Versions before `0.4.0-beta.42` ignore content
type noindex rules, so entries of a ruled type lose that noindex, and saving
Search & social, Website or Indexing rules there removes the rules; roll back
only with a backup that includes the settings. Versions before
`0.4.0-beta.45` rewrite a theme robots value that contains noindex to
`noindex,nofollow`, and versions before `0.4.0-beta.48` drop the theme's robots
value on an entry with Advanced directives. Never delete plugin records as
a rollback shortcut.

## Disable or remove

For the full copyable request, use [the removal prompt](UNINSTALL-PROMPT.md).
It covers the native hosts listed above and keeps all site and
plugin data.

Before removing the package, review the indexing policy that will remain.
Shipit's restrictions, metadata and JSON-LD stop contributing when disabled.
Site-wide, content type and selected taxonomy archive noindex rules owned only
by Shipit no longer apply. Identify the owner that will preserve any required
restrictions before proceeding. Core entry SEO, saved core robots.txt, redirects, content
and media remain with EmDash.

Stop and reconcile current scans, saves and deliveries through their controls.
Turn optional work off, then disable the plugin listed as `shipit-seo` in
EmDash's plugins manager while its code is still installed, and confirm that
the plugins manager lists it as inactive. EmDash 1.3 has no supported view of
a plugin's scheduled tasks, so confirm before disabling that Content health
shows no running scan and that IndexNow delivery is off. Opening the SEO admin page directly while the plugin
is disabled shows that the plugin is disabled and that saved data is kept.
IndexNow Off alone retains its key, queue and history and can still serve the
key file; a disabled plugin's injected key route returns 404. Already running
requests can finish, and remote effects already received are not undone.

Gracefully stop all site instances, workers and schedulers before taking a
consistent database/uploads backup or replacing dependencies. Use a SQLite-aware
backup that preserves committed WAL data; copying only the main database file
can omit saved changes even after writers stop. Retain the matching
configuration, manifest and lockfile and verify recovery on an isolated copy.
Removing the wrapper or npm package alone does not disable the plugin.

Replace `shipitSeo(emdash, options)` with the original `emdash(options)`,
preserving every option, and remove only verified Shipit imports, adapters and
the package dependency. Where archive templates use `taxonomyArchivePage(...)`,
remove that package import and wrapper while retaining the underlying custom
page context passed to `EmDashHead`, the archive route and its content. Keep
`EmDashHead`, body hooks and theme title handling. Build, restart and inspect the
remaining public metadata, indexing rules, sitemap, robots.txt, llms.txt, key
route and redirects. Follow the site's cache invalidation process where needed.

Keep settings, schemas, scores/history, migration records, IndexNow records
and other plugin data in the database. Reinstalling reuses that data and can
retain the inactive state. Explicit Enable can resume retained scheduled work.
Keep optional work off before removal and review saved settings and queues
during reinstallation before deliberately resuming it.
Disabling, removing the package and deleting data are separate operations.
This beta retains data and provides no data-deletion workflow.

## License

Shipit SEO's original code is licensed under [MIT](LICENSE).
Copyright (c) 2026 SHIPIT.

The LocalBusiness type names and hierarchy are derived from the
[Schema.org vocabulary](https://schema.org), licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
The catalogue is based on Schema.org 30.1 and is fixed for this release.
It retains CC BY-SA 3.0 separately from the product's MIT license; see the
[third-party notices](THIRD-PARTY-NOTICES.md).
