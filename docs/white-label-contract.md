# Site-configured white label

## Scope

Base: candidate `0.4.0-beta.43`. Delivered in `0.4.0-beta.44` for native EmDash
and admin 1.3.0 on Node with SQLite. Admin contract 45 and analyzer 21 are
unchanged. No new capability, dependency, host patch or database write is
added. An agency sets a product name and logo once in the site's
`astro.config.mjs`; nothing is stored in the database or the package, so a
package update keeps the branding and removing the option restores the
default name and mark.

## Option

```js
shipitSeo(emdash, { /* EmDash options, unchanged */ }, {
  branding: { name: "Acme SEO", logo: "/brand/acme-seo.svg", logoDark: "/brand/acme-seo-dark.svg" },
});
```

The second argument stays exactly EmDash's options and the two-argument form
is unchanged. Unknown keys in the third argument or in `branding` are errors.

- `name`, required with `branding`: NFC, trimmed, 1 to 32 user-perceived
  characters; a build warning above 16. Refused: C0 and C1 controls, DEL,
  U+2028/2029, U+FEFF, bidirectional controls and `{ } \ < >` (the host passes
  menu labels through its message compiler).
- `logo`, optional, and `logoDark`, optional and only with `logo`: a site path
  of `[A-Za-z0-9._~/-]` starting with one `/`, with no scheme, empty, `.` or `..`
  segment, naming a regular file inside the real `public/` directory reached
  without a symbolic link. `.svg` up to 64 KiB; `.png` and `.webp` up to
  256 KiB, checked by their bytes. Each side 64 to 2048 px, from the PNG or
  WebP header or the SVG `width`/`height` in px or `viewBox`. An SVG must be
  UTF-8 with an `<svg>` root and must not contain scripts, `foreignObject`,
  event attributes, `javascript:`, DOCTYPE or ENTITY declarations, `@import`
  or any `href`, `src` or `url()` target other than a `#fragment`.
- Every failure stops the build with `shipitSeo branding.<option> <value>:
  <rule>.` Shape and name are checked when the configuration loads, files in
  `astro:config:setup` and again in `astro:config:done` with the final
  `publicDir` and `base`. Nothing is fetched.

## Flow

1. The adapter records `installation.branding = { name, logo, logoDark }`;
   each logo is `{ src, type, width, height }` or null, with
   `src = base + path + "?v=" + 12 hex of SHA-256` (`src/branding-files.ts`).
2. `seoPlugin()` and the native `createPlugin()` set the admin page label to
   the name (`seoAdminPage`, `src/index.ts`). An unreadable record gives the
   label `SEO`, no logo and one server warning; it never throws, so public
   metadata keeps working.
3. The admin reads the name from the host manifest it already caches:
   `manifest.plugins["shipit-seo"].adminPages`, page `/seo`. The workspace page
   and the content editor panel each provide it through one context
   (`SeoBrandProvider`, `src/admin-ui/brand-context.ts`). A missing or invalid
   label gives `SEO`.
4. The logo comes from the read-only route `admin-branding` (`plugins:read`,
   GET), read once per admin document and only for a configured name
   (`src/admin-ui/brand-mark.tsx`). The images are the site's own public files.

## Surfaces

| Surface | Configured | No branding | Unreadable |
|---|---|---|---|
| Admin menu and command palette label | name | `SHIPIT SEO` | `SEO` |
| Workspace heading | name, wraps when long | `SHIPIT SEO`, unchanged | `SEO` |
| Workspace mark | logo, `logoDark` in the dark theme; empty slot while read or after a failed read; search glyph without a logo | built-in mark | search glyph |
| Disabled-plugin title, version-mismatch screen, Migration hint on an SEO field a legacy record decides, legacy record link | name | `SHIPIT SEO` | `SEO` |
| All other admin, engine, Block Kit and build-log sentences | no product name | same | same |
| Download file names | `seo-configuration-*`, `seo-pre-import-configuration-*`, `seo-legacy-*` | same | same |

The logo is decorative (`alt=""`, `aria-hidden`), because the name beside it
is visible. Turkish and Dutch catalogues use `{brand}` only in the nominative.

## Stored analysis text

New rows store no product name; analyzer 21 and score fingerprints are
unchanged, because history fingerprints do not use labels. Rows stored earlier
keep their text and are cleaned only when shown: `cleanStoredSeoText` and
`cleanStoredSeoCheck` in `src/check-presentation.ts` apply the exact phrase
table, then a word rule, from `src/legacy-brand-text.ts`. Measured values,
quoted entry text and other names, such as a business called Shipit Digital,
stay as stored. The checklist, the work queue, the search exclusion note, the
sandbox panel and trend issue labels use the cleaned text.

## Never changes

Plugin id `shipit-seo`; npm name `@shipitseo/emdash-plugin-seo` and its
exports, including `shipitSeo` and `seoPlugin`; admin path `/seo` and
`/_emdash/admin/plugins/shipit-seo/seo`; API routes; storage collections and
indexes; option keys `plugin:shipit-seo:*`; export formats
`shipit-seo-portable` and `shipit-seo-legacy-record-export`; JSON-LD `@id`
values; CSS classes and DOM ids; LICENSE and THIRD-PARTY-NOTICES in the package.

## Guard

`assertBrandNeutralArtifact` in `scripts/packed-artifact.mjs`, run by
`scripts/check-packed.mjs`, reads every compiled `.js` and `.css` file and
fails on `Shipit` or `SHIPIT` in shipped text, except the literal
`"SHIPIT SEO"` in the `src/branding.ts` region and the
`src/legacy-brand-text.ts` region. Comments and identifiers are ignored.

## Residuals

- EmDash 1.3 lists configured plugins by id, so the plugins manager shows
  `shipit-seo`. Only a host display-name contract can change that.
- Admin URL, API paths, option keys named in recovery hints and build errors
  that name `shipitSeo()` keep the technical names.
- The host sidebar may shorten long names; dark-mode selectors belong to the
  host. The sandbox Block Kit panel shows no logo.
- The workspace heading wraps by rendered width, not by length, so a name
  short enough to get no length warning can take two lines. Customer
  documents state no length below which the heading stays on one line.

## Browser acceptance

In an installed lab with the exact packed archive: the menu label and
command palette entry, workspace heading and logo in light and dark themes,
names of 16 and 32 characters at desktop and narrow widths, the disabled-plugin
page, the version-mismatch screen, the editor panel hints, an unbranded
control and a removed `branding` option.

Status: passed on the installed `0.4.0-beta.45` archive in the installed
fixture's dev server (beta.46 record, round 4): the menu label, command
palette entry, workspace heading and logos in light and dark themes, invalid
names refused at startup, removing `branding` restoring the default, and
branding kept across the `0.4.0-beta.44` to `0.4.0-beta.45` update. Not yet
exercised: names of 16 and 32 characters at desktop and narrow widths, the disabled-plugin
page and its title colour, the version-mismatch screen, the editor panel hints
and a production build. None of it has run on the release archive yet.
