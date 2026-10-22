# Project development guide

Shipit SEO is a native EmDash plugin. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for setup and review, and [docs/architecture.md](docs/architecture.md) for the
runtime contracts. This beta targets native EmDash and admin 1.3.0 or 1.3.1,
Astro 7.3.2, Node 24.19.0 and SQLite. The default development fixture uses
1.3.0; other runtimes and databases need separate acceptance evidence.

Use pull requests for contributions. Keep review comments constructive and
follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). A passing check does not replace
maintainer review or the contributor agreement.

## Repository map

- `packages/emdash-plugin-seo/src`: shared engine, native integration and admin.
  `index.ts` registers hooks; `astro.ts` wraps the host integration;
  `admin-contract.ts` defines shared requests and responses.
- `packages/emdash-plugin-seo/src/admin-ui`: workspace and editor interfaces;
  `i18n` contains bundled message catalogues and locale fallback.
- `packages/emdash-plugin-seo/scripts`: package build and archive checks.
- `integration/emdash/published-host-1.3.0`: pinned development fixture.
- `scripts/published-host`: host verification and installed-package checks.
- `tooling/plugin-dev` and `plugin-dev.json`: development commands and targets.

## Local commands and evidence

Use Linux or WSL2, with a WSL checkout on the Linux filesystem. Use the versions
in `.nvmrc` and `package.json`; retain the pinned fixture lockfile unless the
change specifically updates dependencies. Install nvm and Corepack if needed.

```sh
nvm install
nvm use
corepack enable
pnpm dev:setup
pnpm dev:doctor
pnpm verify:quick
```

`pnpm dev:admin` starts TSX/CSS HMR. `pnpm dev:engine` refreshes the runtime once
and starts the preview; restart it after an engine edit. Run one preview or
verification at a time. Stop the preview before setup, build or verification.
Use synthetic fixture data and keep authentication shortcuts on loopback.

For product changes, run `pnpm verify` and `pnpm dev:report`. Use the focused
selfcheck invocation and discovery rules in CONTRIBUTING while developing.
Run `pnpm check:translations` for catalogue changes and `pnpm check:public`
before submitting. Check the diff for whitespace and unrelated files.

Report commands actually completed and their limits. A source preview, a
render selfcheck, an installed archive and live provider acceptance establish
different things. Changes to installation or public output need relevant
installed-package evidence. Do not claim support from a different host graph.

## Change ownership and runtime behavior

Keep one cohesive change with its regression coverage. Read nearby code and
selfchecks before editing a contract; coordinate edits to shared files and
preserve unrelated work. CODEOWNERS identifies reviewers; it does not grant
merge approval. Update affected customer guidance and retain third-party notices.

Keep site defaults, publisher identity, content-type templates and entry
customizations distinct. Preserve entry identity, locale, revision guards,
conflict recovery and unknown-save handling. Do not retry an uncertain write
automatically or turn navigation into a save, discard or activation action.

Basic browser checks, focus keywords and previews remain available when optional
server analysis is off. Use the saved snapshot already read for the editor;
do not start scans or write score history to display basic checks. Keep saved
scores and their freshness separate from current browser results. Preserve the
native host's ownership and separate save timing for its SEO fields.

Bound reads and writes by the requested task, permissions and input size. Do not
load all content to decorate a settings screen. Keep optional analysis and
provider submissions explicitly controlled; opening a panel must not acknowledge
costs, start background work or send requests. Feature controls are not a hard
hosting spending cap. Taxonomy archive rules must not alter assigned posts.

## Interface regressions and translations

Check the affected flow in light and dark themes and narrow layouts. Preserve
keyboard operation, visible focus, accessible names and meaningful icons.
Keep checklist rows concise, status labels clear and preview text readable at
its native size. Do not shrink a desktop card into an unreadable sidebar.
Previews are approximate; distinguish unsaved input, last-loaded saved metadata
and published-page evidence. Test loading, empty, error and recovery states.

Follow the catalogue workflow in CONTRIBUTING. Keep English keys stable and
preserve named placeholders and locale fallback. Translate interface values,
not user content, routes or schema properties. Keep language contributions
focused and obtain fluent review; do not add a remote translation dependency.

## Security, storage and customer lifecycle

Check authorization on the server for every privileged operation. Validate
input, lengths, identifiers and URLs at trust boundaries; escape output and
render translations as text. Preserve storage ownership and revision checks.
Keep outbound destinations, redirects, response sizes and timeouts constrained.
Keep secrets out of URLs, logs and client bundles; require explicit configuration
for authenticated provider calls. Never submit to a provider as a UI side effect.
Keep fork checks read-only; do not execute contributed code in a privileged
workflow.

Do not commit credentials, sessions, databases, customer exports, personal data
or machine-specific paths. Use synthetic examples and redact screenshots and
logs. Keep local state out of both the public tree and customer archive. Follow
[SECURITY.md](SECURITY.md) for vulnerability reporting.

Document installation, disabling, removal and data deletion as separate actions.
Retain saved data by default and preserve a verified recovery path, including
consistent SQLite backups with committed WAL data. Do not remove routes or data
owned by the host or another plugin. Contributions use MIT and require the
version-specific agreement described in [CLA.md](CLA.md); do not represent an
unchecked acknowledgement as a verified signature.
