# Contributing to Shipit SEO

Bug fixes, tests, documentation and translations are welcome. Read the
[community conduct guide](CODE_OF_CONDUCT.md) and use Discussions for questions
or ideas that are not ready for an issue.

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`; its preview is
`http://127.0.0.1:4365/_emdash/admin`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

See [compatibility and target upgrades](docs/compatibility.md) for the policy,
available verification modes and how to change a target without stale pins.

## Choose a contribution

| Change | Start here |
| --- | --- |
| Engine or interface | `packages/emdash-plugin-seo/src`; use the [architecture guide](docs/architecture.md) to find the owner. |
| Regression tests | Nearby `.selfcheck.ts` files; use `scripts/published-host` for installed-host behavior. |
| Customer documentation | The package README, installation/removal guides and changelog. |
| Contributor documentation | This guide, the root README and `docs/architecture.md`. |
| Language packs | The catalogue workflow under [Translate the interface](#translate-the-interface). |

Keep the behavior change and its regression check together. Read
[AGENTS.md](AGENTS.md) for project development rules. Documentation and language
contributions are welcome as focused changes of their own.

## Set up the local fixture

Use Linux or WSL2 for the full verification workflow. On Windows, keep the
checkout on the WSL2 Linux filesystem. The complete verification suite is not
yet qualified on macOS.

Install nvm and Corepack if they are unavailable. If the Node version in .nvmrc
is not installed, run `nvm install` before `nvm use`.

From the repository root, select the Node version in .nvmrc and run:

~~~sh
nvm use
corepack enable
pnpm dev:setup
pnpm dev:doctor
pnpm verify:quick
~~~

The default fixture uses the current target's pinned dependency graph. Keep its
lockfile unchanged unless your contribution updates dependencies. No Cloudflare
account, production database or EmDash source checkout is needed.

## Develop and verify

For admin TSX and CSS changes:

~~~sh
pnpm dev:admin
~~~

This starts the source preview with hot module replacement. For engine changes:

~~~sh
pnpm dev:engine
~~~

The engine command refreshes the built runtime before starting the preview.
Stop and rerun it after an engine edit; it is not an engine watcher.

Run one preview or verification command at a time. Stop the preview with Ctrl-C
before setup, a build or verification. Use synthetic content and accounts;
never commit databases, sessions, credentials or production exports.

After setup and one successful `pnpm verify:quick`, you can run a focused
selfcheck while developing. From the repository root, with the preview stopped:

~~~sh
node scripts/run-bounded.mjs focus-editor-basic \
  node --import=./scripts/published-host/host-loader.mjs \
  --experimental-strip-types \
  packages/emdash-plugin-seo/src/admin-ui/editor-basic-analysis.selfcheck.ts
~~~

Replace the final path and report label for the check you are working on. The
loader resolves dependencies from the pinned host graph. Bounded logs and a
receipt go to ignored `artifacts/current-validation/`; one passing check is not
full verification.

Before submitting, run `pnpm check:public` and inspect the files in your diff.
The guard detects known local-file, credential and machine-path patterns; it
cannot establish that text or image content contains no personal information.
Review screenshots, URLs, exports and examples yourself. Use synthetic content,
remove personal contact details and keep local reports out of the pull request.

Engine selfchecks are discovered directly under `packages/emdash-plugin-seo/src/`;
admin selfchecks directly under `packages/emdash-plugin-seo/src/admin-ui/`.
A new nested selfcheck is not picked up automatically; place it beside the
relevant checks in those directories or update the runner explicitly.

Before submitting a product change, select a target that implements full
verification from [the compatibility table](docs/compatibility.md). Replace
`TARGET` with that same exact target in both commands:

~~~sh
pnpm verify --target TARGET
pnpm dev:report --target TARGET
~~~

The report records the selected graph, check results and whether the source
has changed since verification. A working source preview does not establish
that a packed installation works. Include relevant installed-package checks
when changing installation, public output or runtime integration.

Keep changes focused and add a regression check for a bug. Describe the problem,
observable change, checks actually completed and documentation impact. Preserve
permissions, entry locale, revision checks and data ownership. Explain any new
provider requests, background work or operating costs.

## Full verification cache

Full verification installs both packed pnpm and npm consumers offline. The npm
consumer requires a prepared npm cache containing the pinned consumer graph,
passed through the SHIPIT_NPM_OFFLINE_CACHE environment variable. Run the suite
in a loopback-only network namespace. A missing cache produces a not-run result;
it does not qualify a release.

The repository does not yet include a cold-runner bootstrap for that cache.
Contributors without it can run quick verification and report the full check
as incomplete; a maintainer must complete the full release checks before
publication. The reference workflows under docs/ci are inactive examples.
Hosted Repository quality checks do not establish package acceptance.

## Translate the interface

The initial translation scope is navigation and Indexing. Other screens and
stored analysis messages may still use English.

Catalogues are plain JSON under
packages/emdash-plugin-seo/src/admin-ui/i18n/catalogues/. English en.json defines
the stable message keys. To add a language, add one JSON file named with its
canonical locale tag, then add its static import and SEO_CATALOGUES entry in
packages/emdash-plugin-seo/src/admin-ui/i18n/messages.ts.

Preserve every key and named placeholder, such as {count}. Translate the values,
not routes, schema properties, provider identifiers or stored user content.
Render text only; do not add markup or a remote translation service.

For a catalogue-only contribution, you can start without installing the host.
With the pinned Node version, these checks need no dependency installation:

~~~sh
node scripts/check-translations.mjs
node --test scripts/check-translations.test.mjs
~~~

It checks catalogue registration, keys and named placeholders. The plugin tries
the exact admin locale, its base language and then English. Adding a plugin
catalogue does not add a language to the host's language selector.

Keep a language contribution separate from feature changes. Have a fluent
speaker review it and check the translated navigation and Indexing screen,
including narrow layouts and accessible labels. State the locale and checks
completed in the pull request.

## Submit a pull request

Use GitHub's **Fork** button on [logelog/shipit-seo-plugin](https://github.com/logelog/shipit-seo-plugin).
Clone your fork, replacing `YOUR-USERNAME` with your GitHub username:

~~~sh
git clone https://github.com/YOUR-USERNAME/shipit-seo-plugin.git
cd shipit-seo-plugin
git remote add upstream https://github.com/logelog/shipit-seo-plugin.git
git fetch upstream
git switch -c fix/search-preview upstream/main
~~~

Choose a descriptive branch name, such as `fix/search-preview` or
`docs/install-guide`. Set up the fixture and make one focused change. Add a
regression check for changed behavior and update the affected guidance. Keep
generated output and local state out of the commit.

Complete the relevant checks above. Product changes need full verification on
an implemented target and relevant acceptance on the intended supported host;
language-only changes can use the catalogue checks without installing the host.
For documentation, check links and commands against the implementation.

Review your diff, stage only the intended files and commit the change. For
example, replace the file path and commit subject with your own:

~~~sh
git diff
git add path/to/changed-file
git commit -m "Fix the search preview"
git push -u origin fix/search-preview
~~~

Open [a pull request](https://github.com/logelog/shipit-seo-plugin/compare) from your fork
and branch to `logelog/shipit-seo-plugin:main`. Use the PR template to describe the
problem, resulting behavior, completed checks and remaining limits. Include
useful interface screenshots with synthetic content. Read the contributor
agreement below and post its version-specific acceptance in the PR.

Address maintainer feedback and rerun affected checks after revisions. Keep the
check results in the PR current; a local pass is not a hosted status check.

The checked-in verification workflows use read-only repository permissions,
keep checkout credentials out of the working tree and do not publish packages
or merge changes. Forks do not receive repository secrets. A maintainer may
need to approve a first-time contributor's workflow run. Check the pull
request's Checks tab for actual hosted results; a local pass does not establish
that CI ran.

## Review and licensing

Contributions go through a pull request. Keep the branch current, address review
comments and wait for the applicable checks and maintainer review before merging.
[CODEOWNERS](.github/CODEOWNERS) routes reviews; it does not grant merge approval.
See [GOVERNANCE.md](GOVERNANCE.md) for project roles and decisions.

The project currently has one maintainer, `@logelog`. GitHub does not allow
authors to approve their own pull requests. Owner-authored maintenance must
therefore state the checks completed without claiming independent review.
Outside contributions also need the contributor agreement acceptance below.

Shipit SEO uses the [MIT License](LICENSE). Retain relevant third-party notices.
The license choice does not establish release acceptance. For a suspected
vulnerability, read [SECURITY.md](SECURITY.md) before opening a public issue.

## Contributor agreement

Read the [Shipit SEO Contributor Agreement, version 1](CLA.md) before submitting
code, tests, documentation, translations or designs. You retain copyright in
your contribution and confirm that you have permission to submit it under the
agreement and MIT License.

Signing automation is not configured. After reading version 1, post this
explicit acceptance in your pull request:

> I agree to the Shipit SEO Contributor Agreement, version 1.

The maintainer must obtain acceptance from each contributor and record the
agreement version and revision before merging. The PR checkbox acknowledges
reading; it is not a verified signature. A changed agreement requires a new
version and renewed acceptance. Maintainer review and required checks remain
separate from agreement acceptance. Public pull requests should not collect
personal addresses, identity documents or handwritten signature images.
