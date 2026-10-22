# Shipit SEO

SEO tools for native EmDash: search and social metadata, structured data,
indexing controls and saved-content checks.

## Install, operate and remove

The [package guide](packages/emdash-plugin-seo/README.md) describes native
integration and the current feature limits. It includes links to the
[installation](packages/emdash-plugin-seo/INSTALL-PROMPT.md),
[updates and recovery](packages/emdash-plugin-seo/UPGRADE.md), and
[data-preserving removal](packages/emdash-plugin-seo/UNINSTALL-PROMPT.md)
guides. Native updates require an exact package version and a site rebuild;
they do not install themselves when a new npm version is published. Do not
treat an example npm command as evidence that the version has been published.

Optional scans and provider requests use the plugin's explicit feature controls.
No setting can impose a hard cap on a hosting provider's bill. Review resource
use before enabling optional analysis or public requests.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused fixes, tests and translation
PRs. Adding a language needs one JSON catalogue and its static registration;
`pnpm check:translations` checks the contribution without installing the host.
The current translation scope covers navigation and indexing settings.

Pull requests run **Repository quality**: public-file checks, translation
validation and development-tooling tests. These checks run without installing
EmDash. Native build/type/selfchecks and full installed-package verification
are separate checks; the reference workflows under docs/ci are not active.
Read the PR's Checks tab for results from that exact revision.

CI uses read-only repository access, no publishing credentials and no automatic
merges or package publication. See [CONTRIBUTING.md](CONTRIBUTING.md) for review
and translation PRs, and [SUPPORT.md](SUPPORT.md) for questions and bug reports.
For sensitive reports, read [SECURITY.md](SECURITY.md) before opening an issue.
The [architecture guide](docs/architecture.md) maps the source and effect boundaries.

## Compatibility

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`; its preview is
`http://127.0.0.1:4365/_emdash/admin`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

See [compatibility and upgrades](docs/compatibility.md) for the current policy.
Cloudflare Workers/D1, Postgres and
sandbox/registry installation are outside this beta's verified scope. See the
[package guide](packages/emdash-plugin-seo/README.md) for installation and limits.

## Develop locally

Use Linux or WSL2 with the pinned toolchain above. Keep a WSL checkout
on its Linux filesystem. No Cloudflare account or EmDash source checkout is
needed.

```sh
nvm use
corepack enable
pnpm dev:setup
pnpm dev:doctor
pnpm dev:admin
```

Open the preview address above. The preview uses an isolated SQLite
fixture with synthetic content. Keep its development authentication shortcuts
on loopback and out of production. Admin TSX and CSS changes reload through
Vite. Stop the preview before building or running verification.

For engine changes, use `pnpm dev:engine`; restart it after an engine edit.
That command refreshes runtime output once. A runtime refresh intentionally
omits declarations, so run the verifier to restore the full build before
checking package types directly.

```sh
pnpm verify:quick
pnpm dev:report
```

Quick verification checks the engine, admin and source contracts. Select an
implemented full target from [the compatibility table](docs/compatibility.md)
before running full verification. Full
verification requires the prepared npm cache described in
[CONTRIBUTING.md](CONTRIBUTING.md#full-verification-cache) and also exercises SQLite workflows, production output, clean package
consumers and save/recovery behavior. Reports record the source and target;
a working source preview does not establish release readiness.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/emdash-plugin-seo/src` | Shared engine, native integration and admin UI |
| `packages/emdash-plugin-seo/scripts` | Package build and customer-artifact guards |
| `integration/emdash/published-host-*` | Isolated pinned EmDash fixtures and dependency locks |
| `scripts/published-host` | Real-host verification and development helpers |
| `tooling/plugin-dev` | Setup, doctor, serialized tasks and bounded reports |

Local databases, reports, credentials and generated output are ignored. The
customer npm archive has a separate allowlist; contributor tools and fixtures
do not belong in the installed package.

## License

[MIT](LICENSE). Schema.org vocabulary data has separate attribution and license
terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
