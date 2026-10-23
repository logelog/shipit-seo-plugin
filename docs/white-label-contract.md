# Site-configured branding

The `branding` option customizes the admin display name and workspace logo.
It lives in the site's `astro.config.mjs`, outside the plugin package and
database, so a package update keeps the configuration. Removing the option
restores the default name and mark.

This is limited display branding. Broader white-label workflows remain
planned work for 1.0 in the [roadmap](roadmap.md); technical identities and
package notices stay visible.

## Configuration

```js
shipitSeo(emdash, { /* existing EmDash options */ }, {
  branding: {
    name: "Acme SEO",
    logo: "/brand/acme-seo.svg",
    logoDark: "/brand/acme-seo-dark.svg",
  },
});
```

The second argument remains EmDash's options. The two-argument form is
unchanged. The third argument accepts only `branding`, whose allowed keys
are `name`, `logo` and `logoDark`.

| Option | Validation |
| --- | --- |
| `name` | Required when branding is present; NFC-normalized and trimmed; 1 to 32 user-perceived characters, with a build warning above 16. |
| `logo` | Optional site path to an SVG, PNG or WebP in the real `public/` directory. |
| `logoDark` | Optional dark-theme logo; requires `logo` and follows the same file rules. |

Names reject C0 and C1 controls, DEL, U+2028/2029, U+FEFF, bidirectional
controls and `{ } \ < >`. The host passes menu labels through its message
compiler.

Logo paths use only `[A-Za-z0-9._~/-]`, start with one slash and contain no
empty, `.` or `..` segments. They must name a regular file inside the
resolved public directory without traversing a symbolic link. Remote and
data addresses are refused; nothing is fetched.

SVG files are limited to 64 KiB; PNG and WebP to 256 KiB. File bytes must
match the format. Each side must be 64 to 2048 px. SVG dimensions come from
pixel width and height or its viewBox. SVG must be UTF-8 with an `svg` root
and no scripts, `foreignObject`, event attributes, `javascript:`, DOCTYPE,
ENTITY, `@import` or references other than local `#fragment` targets.

Invalid configuration stops the build with an option-specific error. Shape
and name validation run when configuration loads; file checks run at
`astro:config:setup` and again at `astro:config:done` using the final
`publicDir` and `base`.

Owners: `src/branding.ts` and `src/branding-files.ts` under
`packages/emdash-plugin-seo/`.

## Runtime behavior

The adapter records `installation.branding` with the normalized name and
validated image facts. Logo addresses include Astro's base and the first
12 hex characters of the file's SHA-256 as a cache key.

The native plugin's admin page label carries the name. Workspace and editor
contexts read it from the host's cached manifest. Missing or invalid labels
fall back to SEO. An unreadable installed branding record produces that
fallback, no logo and one server warning without stopping public metadata.

The read-only `admin-branding` route uses `plugins:read`. The admin reads
logos once per document for a configured name. The logo is decorative because
the name beside it is visible. Dutch and Turkish labels use the name in the
nominative.

| Surface | Configured branding | Default |
| --- | --- | --- |
| Admin menu and command palette | Configured name | SHIPIT SEO |
| Workspace heading | Configured name, allowed to wrap | SHIPIT SEO |
| Workspace mark | Configured light or dark logo; search glyph if none | Built-in mark |
| Disabled-plugin and version-mismatch titles, relevant migration hints | Configured name | SHIPIT SEO |

The mark stays empty while its read is pending or failed. A label that falls
back after an unreadable branding record is SEO, with a search glyph.

Owners: `src/index.ts`, `src/admin-ui/brand-context.ts` and
`src/admin-ui/brand-mark.tsx`.

## Stored text and technical names

New analysis text contains no product name. Branding labels do not
participate in score fingerprints. Older stored text is cleaned for display
through `cleanStoredSeoText` and `cleanStoredSeoCheck` in
`src/check-presentation.ts` using `src/legacy-brand-text.ts`. Measured values,
quoted entry text and other proper names remain intact.

Branding does not rename the plugin id `shipit-seo`, npm package
`@shipitseo/emdash-plugin-seo`, exported functions, admin or API paths,
storage keys, export formats, JSON-LD identifiers, CSS classes, DOM ids,
LICENSE or THIRD-PARTY-NOTICES. Downloads use the neutral
`seo-configuration-*`, `seo-pre-import-configuration-*` and `seo-legacy-*`
names.

The host plugin manager still identifies configured plugins by id.
The host may shorten menu names; the workspace wraps by rendered width,
so a name below the warning threshold is not guaranteed to fit on one line.
The sandbox Block Kit panel does not show a logo.

`assertBrandNeutralArtifact` in `scripts/packed-artifact.mjs` checks compiled
JavaScript and CSS text through `scripts/check-packed.mjs`. Its explicit
exceptions cover the default-name and legacy-text regions; comments and
identifiers are not visitor copy.

## Maintainer checks

Check the menu, command palette, workspace, disabled-plugin screen,
version-mismatch screen and editor hints with default and configured names.
Cover 16- and 32-character names at desktop and narrow widths, light and dark
logos, invalid files, removing the option and preserving configuration across
a package update. Check an installed production build as well as development
rendering. These cases describe the contract, not full white-label or
cross-platform qualification; see [compatibility](compatibility.md).
