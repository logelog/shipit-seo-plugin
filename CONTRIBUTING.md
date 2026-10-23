# Contributing to Shipit SEO

Bug fixes, tests, documentation and translations are welcome. Follow the
[Code of Conduct](CODE_OF_CONDUCT.md), make one focused change, and submit it
through a pull request. Questions and early ideas belong in
[Discussions](https://github.com/logelog/shipit-seo-plugin/discussions).

## Set up

Fork [logelog/shipit-seo-plugin](https://github.com/logelog/shipit-seo-plugin),
clone your fork and create a branch from the current main. Replace
YOUR-USERNAME with your GitHub username:

```sh
git clone https://github.com/YOUR-USERNAME/shipit-seo-plugin.git
cd shipit-seo-plugin
git remote add upstream https://github.com/logelog/shipit-seo-plugin.git
git fetch upstream
git switch -c fix/search-preview upstream/main
```

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

Use Linux or WSL2, with a WSL checkout on the Linux filesystem. Install nvm
and Corepack if needed, then run from the repository root:

```sh
nvm install
nvm use
corepack enable
pnpm dev:setup
pnpm dev:doctor
pnpm verify:quick
```

Setup uses the selected fixture's pinned dependency graph. Keep its lockfile
unless your change updates dependencies. No Cloudflare account, production
database or EmDash source checkout is needed. Full verification is not yet
qualified on macOS.

## Make a change

The [architecture guide](docs/architecture.md) maps code ownership and runtime
contracts. Read the nearby selfchecks and [AGENTS.md](AGENTS.md) before editing.

For admin TSX and CSS changes, run:

```sh
pnpm dev:admin
```

For engine changes, run:

```sh
pnpm dev:engine
```

The admin preview supports hot reload. The engine command builds the runtime
once before starting; restart it after an engine edit. Stop the preview with
Ctrl-C before setup, builds or verification, and run one of these tasks at a
time. Use synthetic content. Keep database, session, credential and export
files out of commits.

## Check your change

| Change | Relevant checks |
| --- | --- |
| Any contribution | `pnpm check:public`, review the complete diff and run `git diff --check` |
| Compatibility guidance or pins | `pnpm check:compatibility` |
| Translation catalogue | `pnpm check:translations` |
| Engine or admin behavior | `pnpm verify:quick` plus a regression selfcheck for the affected behavior |
| Installation, public output or recovery | Relevant installed-package checks on the intended host |

After setup and a successful quick verification, run a focused selfcheck with
the preview stopped. For example:

```sh
node scripts/run-bounded.mjs focus-editor-basic \
  node --import=./scripts/published-host/host-loader.mjs \
  --experimental-strip-types \
  packages/emdash-plugin-seo/src/admin-ui/editor-basic-analysis.selfcheck.ts
```

Replace the report label and final path for your check. The loader uses the
pinned host graph. Engine selfchecks are discovered directly in
`packages/emdash-plugin-seo/src/`; admin selfchecks directly in
`src/admin-ui/` beneath it. Nested checks need an explicit runner change.

Describe checks that actually completed and anything you could not run.
Do not claim full verification from a source preview or one selfcheck.
Review UI changes in light/dark, narrow and keyboard layouts, including
loading, errors and save recovery. For documentation, check commands, links
and described behavior against the implementation.

### Full verification cache

The full lane is a maintainer release check. Select an implemented full
target from the [compatibility matrix](docs/compatibility.md) and use the same
target for verification and its report:

```sh
pnpm verify --target native-1.3.0
pnpm dev:report --target native-1.3.0
```

It installs packed consumers offline. The npm consumer needs
`SHIPIT_NPM_OFFLINE_CACHE` pointing to a prepared cache of its pinned graph.
The repository has no cold-runner bootstrap for that cache. Without it, report
the full check as incomplete; a missing cache is not a passing result.
Contributors can submit quick results and explain this limitation. Maintainers
complete the required release checks before publication.

## Translate the interface

The current scope covers navigation and Indexing rules; other screens and
stored analysis messages can remain English.

1. Copy `packages/emdash-plugin-seo/src/admin-ui/i18n/catalogues/en.json`
   to a file named with the new canonical locale tag.
2. Translate values, preserving every English key and named placeholder,
   such as `{count}`.
3. Add a static import and `SEO_CATALOGUES` entry in
   `packages/emdash-plugin-seo/src/admin-ui/i18n/messages.ts`.
4. Run the catalogue checks and have a fluent speaker review the UI.

With the pinned Node version, catalogue-only checks need no host installation:

```sh
node scripts/check-translations.mjs
node --test scripts/check-translations.test.mjs
```

Translate interface text, not routes, schema properties or user content. Do
not add markup or remote translation services. Locale fallback tries the
exact locale, its base language and then English. A plugin catalogue does not
add a language to EmDash's selector.

## Submit a pull request

Review and stage only your intended files, commit them with a concise subject
and push your branch to your fork. Open a PR against
`logelog/shipit-seo-plugin:main` and complete its template: the problem,
resulting behavior, completed checks and remaining limits. Update relevant
guidance and include synthetic UI examples when they help review.

Keep secrets, personal data and machine-specific addresses out of prose,
screenshots and logs. The public-file guard catches known patterns, not every
possible disclosure. CI uses read-only access and does not publish packages
or merge PRs. Check the PR's Checks tab for results on its current revision.

Address feedback and wait for maintainer review and required checks.
[CODEOWNERS](.github/CODEOWNERS) routes review requests; project roles and
decisions are defined in [GOVERNANCE.md](GOVERNANCE.md).

## Contributor agreement

Read the [Shipit SEO Contributor Agreement, version 1](CLA.md). You retain
copyright and confirm permission to contribute under the agreement and MIT
License. After reading it, post this explicit acceptance in the pull request:

> I agree to the Shipit SEO Contributor Agreement, version 1.

Signing automation is not configured. Maintainers record each contributor's
agreement version and revision before merging. The PR checkbox is not a
verified signature, and a changed agreement needs renewed acceptance.
Do not post identity documents, personal addresses or signature images in a PR.
