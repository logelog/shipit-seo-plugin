# Project development guide

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks, and
[docs/architecture.md](docs/architecture.md) for source ownership and runtime
contracts. Keep each change focused and preserve unrelated work.

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

## Source and checks

- `packages/emdash-plugin-seo/src`: engine, integration and shared contracts.
- `src/admin-ui` beneath that package: workspace, editor and translations.
- `scripts/published-host`: pinned-host and installed-package checks.
- `tooling/plugin-dev`: setup, preview, verification and reports.

Use Linux or WSL2 with the pinned toolchain. Run one preview or verification
at a time, stopping the preview before setup or checks. Read nearby selfchecks
before changing behavior and add meaningful regression coverage.
Use the focused checks in CONTRIBUTING, then `pnpm check:public` and
`git diff --check`. Translation changes also need catalogue validation.

[compatibility.json](compatibility.json) owns host targets and runtime pins.
Follow [docs/compatibility.md](docs/compatibility.md), rather than replacing
version strings throughout the repository. Keep unsupported verification
modes explicit; do not report an unexecuted check as passed.

## Runtime contracts

Keep site defaults, publisher identity, content-type settings and entry
overrides distinct. Preserve identity, locale, revision guards and ownership
of stored data. Native SEO fields belong to EmDash and save separately from
the content draft.

Basic browser checks, focus keywords and previews must work with optional
server analysis off. Use the saved entry snapshot already loaded by the
editor, not unsaved body edits. Opening a view must not start server analysis, write
history, activate a feature, acknowledge resource use or submit to a provider.

Bound reads and writes. Do not load an entire site to decorate a settings
screen. Preserve explicit scan scopes and independent analysis/IndexNow
controls. Taxonomy archive rules must not change assigned posts.

Navigation must not save or discard work. Keep drafts and their original
revision across workspace navigation. For an uncertain save, inspect the
stored value before another deliberate write; do not retry automatically,
silently rebase a draft or reload away unsaved work.

## Interface and translations

Check affected flows in light/dark, narrow and keyboard layouts. Preserve
focus, accessible names, readable previews and loading/error/recovery states.
Keep checklist wording concise and statuses meaningful. Previews are
approximations; distinguish drafts, saved values and observed public output.

Keep English message keys stable, preserve named placeholders and locale
fallback, and render translations as text. Translate interface values, not
user content, routes or schema properties. Obtain fluent review for new
catalogues and avoid remote translation dependencies.

## Security and data retention

Authorize privileged operations on the server. Validate identifiers, lengths
and URLs at trust boundaries and escape rendered output. Constrain outbound
destinations, redirects, timeouts and response sizes. Keep secrets out of URLs,
logs and client bundles; no provider request may be a navigation side effect.

Preserve customer content, uploads, settings and recovery data. Installation,
disable, package removal and data deletion are distinct operations. Keep a
consistent database/uploads recovery path, including committed SQLite WAL
data. Never delete host-owned routes or records as cleanup.

Do not commit credentials, sessions, databases, customer exports, personal
data, machine paths or fixed workstation admin URLs. Use synthetic examples.
Keep fork checks read-only and contributed code out of privileged workflows.
Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Review

Update affected customer guidance and third-party notices. Describe the
observable behavior, completed checks and remaining limitations in the PR.
Follow the Code of Conduct and contributor agreement. CODEOWNERS requests
review; it does not authorize a merge.
