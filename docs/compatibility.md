# Compatibility and target upgrades

[compatibility.json](../compatibility.json) owns current and retained host
targets, the development toolchain and each reviewed fixture lock hash.
The product release version stays in `packages/emdash-plugin-seo/package.json`;
changing a host target does not rename the product or its analyzer.

<!-- compatibility:matrix:start -->
| Target | Role | EmDash | Admin | Implemented verification |
| --- | --- | --- | --- | --- |
| `native-1.3.1` | Current | 1.3.1 | 1.3.1 | quick |
| `native-1.3.0` | Retained | 1.3.0 | 1.3.0 | quick, full |

Pinned toolchain: Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2**; native Node/SQLite only.

`pnpm verify:quick` selects `native-1.3.1`.
Full verification is available with `pnpm verify --target native-1.3.0` and its prepared offline npm cache.
Read that target's report with `pnpm dev:report --target native-1.3.0`.
A mode listed here describes the runner, not a passing test or release acceptance.
<!-- compatibility:matrix:end -->

## Beta verification coverage

### 0.4.0-beta.57 (unreleased)

This candidate is not yet available on npm. Its checks do not change the
verified scope of the published beta.56 package.

| Environment | Checked scope |
| --- | --- |
| Native EmDash/admin 1.3.1 on Node/SQLite | Package build, both typechecks, engine and admin selfchecks through quick verification |
| Hosted Workers/D1 with EmDash and Cloudflare adapter 1.3.1 | Exact-archive update on an existing site, production build, deployment, automatic browser checks for explicitly mapped custom blocks, preserved published content, and public sitemap/robots.txt/llms.txt responses |

The hosted checks cover the existing shipitseo.com installation. Its browser
cases used the General content profile with no focus keyword; each opened
with a score below Good while optional server analysis remained off. Article
length limits and incomplete-body handling were checked locally. This does
not qualify every Workers installation or its complete update and recovery
lifecycle. Workers/D1 remains experimental.

See [content checks](content-checks.md) for the scoring rules and custom-block
mapping requirements in this candidate.

### 0.4.0-beta.56

| Environment | Checked scope |
| --- | --- |
| Native EmDash/admin 1.3.1 on Node/SQLite | Build, types and selfchecks through quick verification |
| Local Workers/D1 with EmDash and Cloudflare adapter 1.3.1 | Atomic bulk-analysis updates, bounded taxonomy/internal-link queries and sitemap output, including fixed routes, canonical/noindex rules and locale conflicts |

The Workers checks used the real local runtime, native D1 adapter and host
repositories. They cover the affected engine paths, not a complete packaged
site or hosted deployment. Workers/D1 remains experimental.

### 0.4.0-beta.55

For `0.4.0-beta.55`, the completed checks cover:

| Area | Verified scope |
| --- | --- |
| Native 1.3.0 | Full native verification, packed npm/pnpm consumer checks and SQLite/package upgrade recovery |
| Native 1.3.1 | Exact-archive installation, build, compiled checks and focused editor/workspace checks, including Social conflict recovery |
| Live IndexNow | A manual batch of 11 public URLs and an automatic CMS publication notification sent through the native 1.3.0 plugin, both with HTTP 200 responses |
| Public files | A static deployment served its sitemap, robots.txt and the saved llms.txt document with HTTP 200; the sitemap listed all 11 intended pages |

These live checks were completed on 23 October 2026. Automatic settings
persisted after reload, and a real CMS publication event sent a notification.
Other automatic event and retry flows still need verification. Provider
receipt does not establish crawling or indexing.

Full native 1.3.1 verification, every lifecycle UI flow, native SEO dirty-draft
and lost-acknowledgement recovery, full editor locale switching, and npm
update/removal/reinstallation remain unqualified for that release. Later
candidate checks are listed separately above. Complete Workers/D1 installation and recovery workflows,
provider delivery, Postgres and sandbox/registry installation remain
unqualified. A static Cloudflare Pages deployment does not establish
Workers/D1 runtime compatibility.

See the [indexing guide](indexing.md) for public-output and submission checks.

## Change a target

1. Add a separate fixture with its exact manifest and lockfile. Review the
   dependency graph and record its SHA-256 in `compatibility.json`. A null hash
   means pending review and is refused by CI metadata checks.
2. Add the target's exact EmDash/admin versions, fixture path, port and implemented
   verification modes. Keep existing fixture directories and their data separate.
   A new target must refuse a mode until the required checks are implemented;
   skipping those checks is not a successful verification.
3. Select the new `currentTarget`. Retain older supported targets explicitly in
   `retainedTargets`, or remove support as an intentional release decision.
4. Run `pnpm sync:compatibility` and `pnpm check:compatibility`. Review the resulting
   manifest, Node pins and current documentation. The synchronizer does not
   install dependencies, fetch a release or change fixture manifests, lockfiles,
   existing site data, changelog history or acceptance receipts.
5. Run the implemented checks and install the exact candidate archive in a
   separate acceptance environment. Preserve the source/target/archive identity.
   Declaring support or matching a lock hash does not establish that these
   checks passed.

If the package version has already been published, changed package bytes need
a new version. Review changes to peer ranges, runtime behavior, storage,
installation and recovery before publication; see [releasing.md](releasing.md).

## Check for drift

`pnpm check:compatibility` compares managed documentation, package peers and
development pins, Node/package-manager settings, fixture manifests and reviewed
lock hashes with the policy. It also checks development and runtime target
selection. It runs locally without dependency installation or network access.

`pnpm sync:compatibility` updates only the named current documentation blocks
and derived package/toolchain fields. The blocks use `compatibility` markers;
edit the policy instead of those blocks. Keep current compatibility statements
there or link to this page. Historical release notes, version-specific examples,
retained fixture pins and earlier acceptance records keep their original values.
