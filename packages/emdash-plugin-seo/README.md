# Shipit SEO

Search and social metadata, content checks, structured data, Local SEO and
indexing tools for native EmDash sites.

<!-- compatibility:package:start -->
Version `0.4.0-beta.57` is a native beta.

Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:package:end -->

Start on a copy of your site. Read the
[installation guide](INSTALL-PROMPT.md), or use
[UPGRADE.md](UPGRADE.md) for an existing installation.
Shipit runs in the trusted host process; it does not provide sandbox isolation.

## Install

Use the package manager and lockfile your site already uses. For npm:

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.57
```

For pnpm, use this instead:

```sh
pnpm add --save-exact @shipitseo/emdash-plugin-seo@0.4.0-beta.57
```

Import the wrapper in the existing Astro configuration:

```js
import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";
```

Replace the existing integration call, keeping its complete options:

```diff
- emdash(options)
+ shipitSeo(emdash, options)
```

Keep the existing default `emdash` import from `emdash/astro`, host adapter,
database, storage, collections, locales, other plugins and integrations.
Register EmDash once. Do not add another `emdash()` call or a separate
`seoPlugin()` entry. No companion admin package is required.

Run the site's checks and production build, restart, and open **SHIPIT SEO**
in EmDash. Installation does not seed content, start a scan or enable IndexNow.
With no saved site-wide indexing preference, Shipit adds no site-wide noindex.

See [installation](INSTALL-PROMPT.md) for template integration, public URL
configuration and the first checks.

## Set up your site

1. In **Local SEO**, use **Edit website** to save the website name and production
   URL. Keep that address consistent with Astro's `site` and EmDash's Site URL
   or configured site origin.
2. Choose the publisher: Person, Organization or Local business. Complete the
   relevant contact, official profile, address and hours fields, then review
   and save. Website settings and publisher identity save separately.
3. In **Search & social**, choose fallback sharing values and an image.
4. Review **Indexing > Indexing rules** and **Sitemaps**.
5. Open one saved entry and inspect its checklist, previews and public output.

Changing publisher identity can change its structured-data ID. Custom-schema
references are not rewritten. A saved setting or schema can affect a published
page immediately, so review the intended change before saving.

### Use your own name and logo

Set admin branding as the wrapper's third argument:

```js
shipitSeo(emdash, options, {
  branding: {
    name: "Acme SEO",
    logo: "/brand/acme-seo.svg",
    logoDark: "/brand/acme-seo-dark.svg",
  },
})
```

The name is required when branding is supplied and must be 1 to 32 characters.
The build warns above 16 characters; check long names at narrow widths.
Control, line-break and text-direction characters and `{ } \ < >` are refused.

Logos are optional regular files inside the site's `public/` directory:
SVG up to 64 KiB, or PNG/WebP up to 256 KiB, with 64 to 2048 px on each side.
An SVG needs dimensions or a viewBox and must not contain active content or
external references. Remote/data URLs, parent-directory paths and symlinks
are refused. `logoDark` requires `logo`; without it, one logo serves both themes.

Restart after changing branding or a logo. Invalid options stop configuration
loading and the build. Branding stays in site configuration across package
updates. It changes the admin name and mark, not the package/plugin ID,
routes, storage keys or required license notices. This is admin branding,
not a claim of complete white-label support.

## Work in the editor

### Basic editor checks

Opening a saved entry automatically runs basic browser checks and shows focus
keywords and a search preview, even with optional server analysis off. Posts
default to Article checks; Pages and custom types use General content unless
an assessment profile is saved. Change the choice in **Analysis options**.

Checks use the saved content snapshot and local keyword input, not unsaved
body edits or the rendered page. They do not start a scan or store history.
Keyword changes save after a short pause; check the save status before leaving.
A failed keyword save offers Retry rather than retrying itself.

The score is checklist guidance, not a ranking prediction. Article length and
keyword thresholds are editorial rules; General content has a short-page
policy. Unread evidence remains unassessed, and a result can show
**Partially checked** or **Too little text to score** instead of a number.
Noindex is reported separately from the score.

In **0.4.0-beta.57**, an unset focus keyword limits an otherwise available
score to 79. Lower limits still apply, including 40 for Article bodies under
50 words and 70 for 50-599 words. These are checklist
rules, not search-engine requirements. See the [content checks guide](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/content-checks.md)
for score limits, missing evidence and deliberate result refreshes.

### Custom content blocks

The following configuration applies to **0.4.0-beta.57**.

Standard Portable Text and Tiptap bodies are read automatically. A custom
block needs a description of the fields its template actually displays.
Configure `contentAnalysis` in the third argument of `shipitSeo()`:

```ts
shipitSeo(emdash, config, {
  contentAnalysis: {
    mappings: [{
      collection: "pages",
      bodyField: "content",
      blocks: [{
        type: "callout",
        version: 1,
        fields: [
          { kind: "heading", path: ["heading"], level: 2 },
          { kind: "richText", path: ["body"] },
        ],
      }],
    }],
  },
})
```

This example reads `heading` and `body` only from saved `callout` blocks with
`_version: 1`. It does not count IDs, colours, settings or other text fields.
The same mapping runs for automatic editor checks and saved server analysis;
opening an entry still needs no bulk-analysis activation or provider request.

Use `text` for prose, `heading` with a level, and `richText` for a nested
Portable Text or Tiptap document. A `group` with a path such as `["items", "*"]`
visits repeater items in order; its `fields` use paths relative to each item.
A `link` selects its visible label with `path` and its URL with `href`. An
`image` selects its source with `path` and alt text with `alt`. URLs and image
alt text do not become body prose. Composite repeater fields must be grouped
so each label stays paired with its own URL or image.

Mappings can be scoped to `slugs`. A block rule can use
`when: { path: ["variant"], oneOf: ["detail"] }`; the first matching rule wins.
An empty `fields` list explicitly excludes a block the template does not
render. Top-level `fields` can describe visible entry fields outside the body.
Keep these declarations aligned with template changes and block versions.
They do not change the renderer, metadata or saved content.

Unknown block versions, unread fields and exceeded extraction limits leave
checks incomplete and withhold a numeric score. The plugin does not crawl the
rendered page or guess which arbitrary strings are content. Shared navigation,
transcluded entries and template-generated text are outside these saved-body
checks. Changing a mapping makes saved results stale; it does not start a scan.


### SEO saves

**Edit snippet** opens General in **Edit SEO**. **Save SEO fields** saves native
title and description separately from the content draft. Social can also
choose, replace or clear the native custom image; clearing reveals an inherited
image rather than deleting the media item.

Save other post changes first. An SEO save on a published entry can affect
the live page before the content draft is published. EmDash's native SEO panel
still owns canonical and entry indexing changes.

Social title and description use their own **Save social text** action.
Native fields, Social text and post content are not one atomic save.
On a conflict or uncertain result, keep the draft and use the offered saved-value
check and review before another explicit save. Do not reload away unsaved work
or assume that a connection failure means the write failed.

Previews approximate search and social layouts. The theme still owns the
document title, and a preview does not prove that public HTML changed.

### Schema for a post or page

Choose **Schema** below the preview. **Schema in use** lists entry, content-type,
shared and site contributions with their sources. Only entry-owned records
can be edited or removed there.

**Add schema** offers Article, BlogPosting, WebPage, Service and FAQ forms.
Use the JSON editor for other types or richer records; changing editing modes
must preserve custom properties. Enter facts visible on the page.

**Preview** checks the unsaved contribution; **Save schema** is a separate save
and can affect a published entry immediately. A matching type warns about
another graph rather than replacing defaults or other schemas.
Inspect the final public JSON-LD separately.

## Use the workspace

| Area | What it does |
| --- | --- |
| Overview | Setup actions and a sample of recent saved analysis results |
| Work queue | Review saved content issues and image-alt findings, then open the entry |
| Content health | Explicit filtered scans and up to 50 recent saved scores |
| Trends | Retained history and comparable score changes |
| Templates | Content-type suggestions and social fallbacks |
| Search & social | Fallback sharing metadata and image |
| Schema | Schema map, custom schemas, Library and Defaults |
| Local SEO | Website and publisher identity |
| Indexing | Indexing rules, Sitemaps, Robots.txt, llms.txt, IndexNow, diagnostics and redirects |
| Feature controls | Modules and separate optional-work controls |

Navigation retains workspace drafts until you save, discard, reload or leave
the workspace. Moving to another page does not save or enable anything.
Each form has its own save owner and revision handling.

Library templates are reusable starting points. **Use template** creates an
independent copy; changing the library does not update saved entry copies.
Schema Preview predicts Shipit's contribution, not theme or other-plugin output.

### Saved-content analysis

Choose and save an Article or General content profile before server analysis.
In **Analysis options > Saved analysis & history**, **Save analysis** checks
that entry's last-saved version. With automatic analysis paused, it updates the
current score without adding history.

Automatic checks, history and bulk scans require activation and resource-use
acknowledgement in **Feature controls**. To scan, select scope in Content health
and choose **Start analysis**. Activation does not start a catch-up scan.
Scans run while the panel is open; a paused run needs **Resume**.

Saved results are distinct from current browser checks. Content health shows
saved scores and checks freshness for a limited selection. Changed inputs show
**Analysis needs refreshing**; older analyzer results stay stored without
current numbers or comparisons. Upgrades do not backfill history.

Analysis uses host CPU and database resources. Work bounds are not a hosting
spending cap. A configuration import requires fresh local activation for
automatic analysis, history and bulk scans.

## Indexing tools

### Site-wide indexing

**Indexing rules** shows saved **Index** or **Noindex** states separately from
unsaved choices. Site-wide noindex overrides content-type rules, which override
an entry's ability to appear in search. These controls only add restrictions.
Choosing Index removes that rule; it cannot override another noindex owner.

Site-wide and content-type restrictions emit noindex, nofollow and exclude
affected content from a Shipit-owned sitemap. Taxonomy archive rules affect
only explicitly connected archive templates, not assigned posts.

### Sitemaps and diagnostics

Select public, anonymously accessible content types in **Sitemaps**.
Exclusions remove addresses from the sitemap; they do not add noindex or
restrict access. Another file, route or integration can own the public output.

**Explore sitemap** supports file selection, search, Listed/Left out filters
and 25/50-row pages. Counts of published candidates differ from included URLs.

**Crawl diagnostics > Content graph > Analyze sample** checks a bounded sample:
at most 1,000 content records across content types and 20,000 editor links.
Unresolved links or possible orphans need confirmation on the rendered site.
**Rendered crawl** is a separate manual, bounded operation. Neither is a full
large-site crawl or a guarantee that the site has no issues.

**Robots.txt** edits the same text as EmDash Settings > SEO; the later save wins.
The **llms.txt** output switch applies immediately, while text edits need Save.
Redirects remain EmDash-owned rules.

### IndexNow

IndexNow starts off. It needs a public HTTPS root origin without a custom port.
Select **Enable IndexNow** to create a key, verify its public file and enable
delivery in one action. When the plugin owns `/indexnow-key.txt`, it serves the
file automatically. When no key has been configured, first Astro setup can
reuse a valid key already served at that default path, without changing the
site's file. **Try again** can finish this automatic setup after a failed check.

Setup preserves manually configured keys, custom key locations and keys from
a previous activation. The key is public proof of site ownership, not an
account credential. If verification fails, delivery stays off for a new
setup; the error identifies a blocked request, missing file, redirect, invalid
plain-text response or mismatched key. See the
[indexing guide](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/indexing.md)
for setup and troubleshooting.

Automatic submission is a separate choice. Enabling delivery does not submit
all content or enable automatic submission. Provider acceptance is not indexing,
and Google does not participate in IndexNow.

Turning delivery off retains its key, settings, queue and history. Already
dispatched requests can still finish, and a timeout cannot prove whether the
provider received them. Review retained work before re-enabling.

Review **Submission history** for the URL list, source, last attempt and HTTP
result. **Sent** means HTTP 200; **Accepted** means HTTP 202 with key validation
pending. Neither status proves that a page is indexed. Refresh reads the
history without submitting the URLs again.

Live manual delivery and an automatic CMS publication notification have been
verified with beta.55 on native EmDash 1.3.0 using Node/SQLite. Other automatic
event and retry flows still need verification.

## Other SEO plugins

**Feature controls** reports assessed overlapping plugins and pauses the
affected Shipit output. Use **Manage plugins** and **Check again** to review
activation; these actions do not disable another plugin or import its data.

Unreadable inventory pauses guarded output. Readable indexing restrictions
remain present. The assessment does not cover every plugin, trusted markup
fragment or custom collector, so inspect the public page for duplicates.

## Limits

- Workers/D1 coverage is experimental; see the
  [compatibility coverage](https://github.com/logelog/shipit-seo-plugin/blob/main/docs/compatibility.md)
  for checked versions and flows. Full native 1.3.1 verification, Postgres and
  sandbox/registry installation remain unqualified.
- Other automatic IndexNow event and retry flows, full locale-switching
  behavior of Edit SEO, and npm update/removal/reinstallation still need
  verification. Save or discard popup edits before changing locale.
- The theme owns its title, templates and competing public routes. Keep the
  correct entry/locale context and inspect anonymous output.
- Conditional saves can conflict or have an uncertain result. Advanced robots
  directives and per-entry schema-default switches use later-save-wins behavior.
- Invalid or unreadable SEO settings contribute no Shipit metadata or noindex;
  a Shipit-owned sitemap returns 503. Core entry restrictions remain independent.
- Custom schemas and library templates have bounded inventories and document
  sizes. A reached cap can omit output and produces a warning.
- Analysis, previews and structured data do not guarantee rankings, rich
  results, search indexing or provider verification.
- Legacy migration requires host conditional-write support. Installation never
  migrates or deletes retained data.

## Upgrade and recovery

Follow [UPGRADE.md](UPGRADE.md) for a deliberate exact-version update and a
consistent database/uploads recovery plan. The configuration export is a
settings transfer, not a full backup; it excludes operational and content-owned
records. Package updates do not upgrade EmDash or remove old data.

For data-preserving removal and reinstallation, follow
[UNINSTALL-PROMPT.md](UNINSTALL-PROMPT.md). Disable the plugin before removing
its installed code; deleting a dependency alone does not disable it.
This beta provides no data-purge workflow.

## License

Shipit SEO's original code uses [MIT](LICENSE). Copyright (c) 2026 SHIPIT.
Schema.org LocalBusiness vocabulary data retains its separate CC BY-SA 3.0
terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
