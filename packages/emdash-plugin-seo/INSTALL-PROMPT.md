# Install Shipit SEO in an existing EmDash site

Copy the request below into your site's development task. It targets the
native `@shipitseo/emdash-plugin-seo@0.4.0-beta.54` beta release.
It does not authorize a deployment, production-data changes or IndexNow
submission.

For an existing installation, read [the upgrade guide](UPGRADE.md) first.
For later removal while keeping data, use [the removal prompt](UNINSTALL-PROMPT.md).

```text
Install Shipit SEO 0.4.0-beta.54 in this existing site and verify the actual
admin and public output.

First inspect the repository's instructions, package manifest/lockfile,
Astro configuration, EmDash setup and public page layouts. This beta targets
EmDash and @emdash-cms/admin 1.3.0 or 1.3.1, native Node and SQLite; its tested host uses
Node 24.19.0 and Astro 7.3.2. If the site uses another host/runtime/database,
report the mismatch before changing it. Do not upgrade the host as part of
this task.

Use the site's existing package manager and install the exact version:
  npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.54
For pnpm, use pnpm add --save-exact with the same package and version.
Use the equivalent exact-save command for another existing package manager.
Do not create another lockfile or install the historical Shipit admin package.

In the actual Astro config, import:
  import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";

Replace the existing emdash(options) call with shipitSeo(emdash, options),
where emdash is the site's existing default import from "emdash/astro".
Preserve the full existing options and all other configuration: database,
storage, collections, locales, plugins, adapter and integrations. Keep EmDash
registered once. If this site already lists seoPlugin(), remove that one
entry when adopting the wrapper; preserve the other plugins and existing
shipit-seo data. Do not add a second emdash() call or a second Shipit descriptor.

If this site has category, tag or custom-taxonomy archive templates, inspect
how each resolves its actual term and creates its custom page context. Bind
that existing context with taxonomyArchivePage(context, term.name), imported
from @shipitseo/emdash-plugin-seo/taxonomy-archives, and pass the result to the
existing EmDashHead. Do not guess URL prefixes, invent archive pages or mark
content entries as archives. Preserve the route's content and canonical.
Archive noindex choices belong to Indexing rules; leave them unchanged unless
the owner chooses them. Verify a selected archive and an associated post
separately in an isolated test. An unconnected template is not covered.

Keep the site's real canonical origin in Astro's site setting. Do not replace
it with an example domain. A local origin is valid for local SEO checks but
cannot enable IndexNow. IndexNow requires public HTTPS at the root path with
no custom port. Leave its delivery and automatic submission off during this
task; do not send a provider request.
Sitemap addresses, the robots.txt Sitemap line and publisher structured data
take EmDash's site address before Astro's site: the emdash siteUrl option,
the EMDASH_SITE_URL environment variable, the Site URL in EmDash's settings
and a production URL saved in the SEO Website settings. Each one that is set
must equal the real public origin. Report any that differs; do not change
stored settings without asking me. Also check the website and organization
names in the served publisher structured data: without a website name saved
in the SEO Website settings and without the site title EmDash's setup wizard
stores, both are named "Website". Report that instead of guessing a name.

Inspect the actual templates. Preserve EmDashHead from "emdash/ui" with the
correct page/content identity and locale. If a layout omits it, integrate it
using the public API of the installed EmDash version and the site's existing
page model. Preserve its body hooks. Avoid duplicate metadata owners.

The theme owns the single HTML <title>. In EmDash 1.3.0, EmDashHead renders
metadata but no <title> element, and Shipit SEO does not add one. Inspect how
each page template obtains its title. A template that hand-writes the entry's
own title into <title> ignores the saved native SEO title: render the saved
SEO title with the theme's fallback instead, for example from getSeoMeta()
exported by "emdash", and keep exactly one <title> element. Then verify the
rendered result. Do not invent an EmDashHead renderTitle option or an
unsupported Shipit title resolver. Shipit's generated title templates remain
suggestions and social fallbacks in this beta; do not claim they automatically
update document titles.
Previews are approximate. In the content editor, Edit snippet under the search
preview opens Edit SEO on General, with editable native SEO title and meta
description fields; Save SEO fields in the dialog footer saves them separately
from the content draft, and blank fields inherit their fallback. On a published
entry an SEO save updates the live page at once, even while other changes are
still a draft, so save the post's other changes first: after another save,
EmDash asks to confirm unsaved post changes. Verify one Save SEO
fields change end to end: its confirmation, and the saved values read back
after reopening the entry. Verify the owner guidance in ordinary and Result
page modes. Settings > SEO in the content editor remains available.
Keep the resolved preview URL distinct from the checked slug and canonical
editing control; retain field-specific ownership guidance.

In the SEO workspace, the Website form owns the website name and production
URL; Edit website on the Local SEO Identity step opens it. The numbered Local
SEO steps separately own Person, Organization or Local business selection.
Its Social step owns official profile URLs; Contact keeps phone and email.
Status and entity changes sit on the Review step. Review entity ID/reference
consequences for a person/organization change. Do not rewrite custom schemas
or change legacy settings to bypass that review.

Save entry social overrides explicitly with Save social text in the Edit SEO
footer. A confirmed save acknowledges storage independently of preview
refresh. For an unknown result, Check saved social text reads the record
without retrying the write. A save
may still finish on the server after the fifteen-second confirmation timeout.
After a conflict or different stored values, review the record and deliberately
accept its revision as the baseline before another explicit save. Clearing
both fields removes the canonical override; an older slug-alias override can
still supply Social values.

Social title/description edits update the local card before saving. The
300/1000 input caps are storage limits, not platform display limits. Review the
visible approximation and clipping guidance; do not treat the card as a
guarantee of a platform's rendered or cached result. The card keeps available
fields visible through failed refreshes and distinguishes unsaved text, saved
sharing values and fields that could not be read. After clearing both fields,
refresh metadata to resolve any inherited sharing text.

Social drafts, the saved baseline and pending saves, saved-value checks or
unresolved reviews survive tab and desktop/mobile changes within the same
editor form, account, entry and locale. Close is unavailable during a save or
check. An accepted ordinary Close discards unsaved edits and completed notices;
unknown results and reviews keep their drafts. Changing that context, signing
out, changing permissions or reloading clears local state.

Preserve all existing content, plugin settings, databases and uploads. Do not
seed, import, reset, migrate, delete or overwrite retained site data. Use an
isolated synthetic fixture for any write needed to verify this installation.
If a real-data upgrade is separately requested, require a consistent tested
backup/recovery process before proceeding. A configuration export alone is
not a database backup. Do not change the site's indexing policy.

EmDash can report a revision conflict when SEO saving overlaps with unsaved
post changes, autosave or publication. Wait for a confirmed save before
publishing. The Edit SEO dialog stays open with its edits when EmDash saves the
entry. If the result conflicts or is uncertain, use Check saved SEO fields and
reconcile the saved values before continuing; do not reload with unsaved
edits. Do not install a host patch as part of this plugin installation.

Schema workspace edits and deletes require the exact reviewed record revision.
After a conflict, retain the draft and review the current saved record before
another explicit save. A configuration refresh alone must not rebase a draft.
An unknown result requires read-only inspection of its exact target; do not
retry, assign a replacement create ID or claim which request committed. Local
recovery state lasts only while the workspace stays mounted. Keep a backup
before import: per-record revision checks do not make a bundle transactional,
and an interrupted import can leave partial changes while preserving newer edits.

The Schema button under the editor's search preview opens the entry Schema tab.
It lists Schema in use first, with a source badge per row, and offers guided
Article, BlogPosting, WebPage, Service and FAQ forms, with JSON editing for
other types and richer records. Verify a guided
form and an unchanged rich JSON record only in an isolated synthetic fixture.
Preview is an explicit unsaved-contribution check; Save schema is independent of
content saving and can affect an already published entry. Preserve inherited
owners, exact target/locale, revision review and unknown-result recovery.
For a published entry without its own canonical, verify a {{canonical}}
candidate against the registered public route and actual served JSON-LD.
A theme canonical override can differ; unavailable routes and draft-only
inferred paths must not be shown as resolved canonical predictions.

Navigation and Indexing rules follow the host admin language for English,
Turkish and Dutch. Other screens retain their existing language. The navigation groups
pages under Content, Search appearance, Indexing and Settings; the Indexing
item opens Indexing rules. Use Indexing rules for the plugin's site-wide noindex
preference, its content type rules and its taxonomy archive rules. Content
type rules start empty; leave them unchanged unless the owner chooses them.
Sitemap exclusions do not add noindex. If the stored SEO settings cannot be
read, the plugin adds no metadata or noindex and its sitemap answers 503;
report that instead of editing or deleting stored records. Removing the
package preserves its stored settings and content as described in UNINSTALL-PROMPT.md; the new
navigation adds no cleanup step.

Run the repository's relevant checks and production build. Restart locally
and verify the exact installed package, with no linked product source:
- The SEO workspace opens for an administrator; check desktop and narrow views.
- Overview shows one Next step and open setup details with Open buttons.
  Saved-result numbers describe a limited recent sample, separate
  from the setup score; distinguish unavailable results from an empty sample.
  Refresh overview reads the summary without running analysis or enabling features.
- One synthetic entry's existing SEO fields persist after save and reload.
- Its anonymous published HTML has one canonical, the intended description
  and social values, exactly one <title> showing the saved native SEO title
  when one is set, and safely rendered JSON-LD.
- Draft/noindex rules remain correct. If the site is multilingual, verify
  each relevant locale and canonical/hreflang ownership.
- /sitemap.xml and /robots.txt agree with the ownership shown in the admin.
  Check /llms.txt only if already enabled; keep existing route/file ownership.
  Exclude members-only and password-protected content from sitemap selections;
  published status alone does not establish anonymous access.
- A saved entry exposes focus keywords, previews and basic browser checks without enabling server analysis. Keyword saves do not create score history.
- Canonical and indexing changes in EmDash's native SEO panel save separately from the content draft and can affect the live page immediately. Confirm the field save and public result without waiting for a content Save.
- Installation did not enable IndexNow, activate automatic analysis or start a site-wide score scan.
- After explicitly choosing and saving an assessment profile in Analysis options, open Saved analysis & history and choose Save analysis to check one last-saved entry without activating automatic analysis. With automatic analysis paused, this action updates only its current score and leaves history unchanged.
- Automatic analysis, history and bulk scans require explicit resource-use acknowledgement and a saved assessment profile. Do not activate them as an installation side effect; a bulk scan also needs an explicit Start.

Report the files changed, exact versions/checks, observed admin/public result
and remaining limitations. Distinguish local Node/SQLite checks from unproved
Cloudflare/D1, Postgres, sandbox and live IndexNow behavior. Do not publish,
deploy, change production data or claim search-engine indexing as part of this
task.
```

## Use your own name and logo

An agency can show its own product name and logo in the EmDash admin. Copy
this request after the installation above has been verified. The rules are in
[the README](README.md#use-your-own-name-and-logo).

```text
Set this site's SEO admin branding in the existing Astro configuration. Use the
name "<agency product name>" and, if provided, the logo files I supply.

Keep the existing shipitSeo(emdash, options) call and its complete EmDash
options. Add branding only as the third argument:
  shipitSeo(emdash, options, { branding: { name, logo, logoDark } })
Do not put branding inside the EmDash options and do not add another emdash()
call or seoPlugin() entry.

name is 1 to 32 characters without control, line break or text direction
characters and without { } \ < >. The build warns about a name longer than 16
characters, but a shorter name can wrap in the workspace heading too, and a
long one may be shortened in the admin menu; report how the heading and the
menu show it.

Place each logo file inside the site's public/ directory, for example
public/brand/agency-seo.svg, and reference it by its site path,
/brand/agency-seo.svg. Use a regular file, not a symbolic link, a remote or
data: address, or a path with .. segments. Use .svg up to 64 KiB, or .png or
.webp up to 256 KiB, with content that matches the extension and 64 to 2048 px
on each side; an SVG needs width and height in px or a viewBox. An SVG must not
contain scripts, event handlers, foreignObject, DOCTYPE or ENTITY declarations,
javascript: addresses, imported style sheets or references to other files.
logoDark is optional, needs logo and is shown in the admin's dark theme.
Do not edit the logo files to pass these rules without asking me.

Keep the installed package's LICENSE and THIRD-PARTY-NOTICES.md files. Do not
rename the plugin id, package, storage, routes or option keys; the plugins
manager keeps listing the plugin as shipit-seo.

Run the site's checks and production build, restart and verify:
- The build accepts the branding; an invalid value stops it with a message
  naming the option, the value and the rule. Report any warning.
- The admin menu and command palette entry, the workspace heading and the logo
  show the configured branding in light and dark admin themes, at desktop and
  narrow widths.
- No other admin page or public page shows the earlier product name.

Report the files changed, the build output and what you observed.
```
