# Releasing Shipit SEO

Use this checklist to qualify an exact source revision and customer archive.
Repository checks, native checks and installed-package checks cover different
parts of a release.

## 1. Prepare the change

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

Work through a normal pull request from the public repository's current
main. Keep its history. Review the final source diff, dependencies,
documentation and third-party notices before release.

- Update the product version and `SEO_ENGINE_VERSION` together. Never replace
  bytes at a published version.
- Update `compatibility.json` when changing host support, then run
  `pnpm sync:compatibility` and `pnpm check:compatibility`.
- Update the changelog and exact installation pins. Describe behavior,
  storage changes, upgrade steps and downgrade limits.
- Keep MIT, third-party notices, governance and contributor-agreement
  requirements consistent. Check the PR's actual hosted results.

Repository documentation can improve between package releases. Those edits
do not change an already published npm archive; include customer-guide changes
in the next package version rather than repacking the old one.

## 2. Run the relevant checks

Stop previews and serialize native verification. Use synthetic data and
isolated copies, with optional provider delivery off.

```sh
pnpm check:public
pnpm check:translations
pnpm check:compatibility
pnpm verify:quick
```

Run an implemented full lane for release qualification. The current target
does not implement full verification; see the
[compatibility matrix](compatibility.md). The retained target's full lane is:

```sh
pnpm verify --target native-1.3.0
pnpm dev:report --target native-1.3.0
```

Full verification installs packed consumers offline and requires a prepared
`SHIPIT_NPM_OFFLINE_CACHE` for npm. There is no cold-runner bootstrap for it.
A missing cache produces an incomplete result, not a pass.

Automatic Repository quality needs no host installation. Manual Native checks
runs build, types and selfchecks for the current target. Neither publishes
packages or establishes every lifecycle/UI flow. The reference workflows in
`docs/ci` are examples, not active release jobs.

## 3. Freeze the customer archive

Record the reviewed commit, clean tree, toolchain and fixture lock hashes.
Create the candidate archive once and record its filename, version, size,
SHA-256 and package integrity.

Check the archive itself, not a fresh repack: runtime exports, declarations,
styles, license, notices, customer guide links and version pins. The package's
`files` allowlist must exclude fixtures, tests, source maps, reports, credentials
and local state. The helpers in
`packages/emdash-plugin-seo/scripts/packed-artifact.mjs` validate artifact and
branding boundaries.

A later source, compiled-output or customer-document change needs a new
candidate and affected checks. Results remain bound to the archive they tested.

## 4. Check installation and recovery

Install the exact archive on each advertised host graph. Record npm and pnpm
paths separately; a clean install does not establish update, removal or
reinstallation behavior.

Use the existing lifecycle helpers for their stated scope:

- `scripts/published-host/package-upgrade-recovery.mjs` exercises released
  runtime behavior, retained records and SQLite recovery for an exact pair.
  It does not perform package-manager installation or render public HTML.
- `scripts/published-host/native-removal-smoke.mjs` exercises pnpm removal,
  build, public fallback and reinstallation. It does not establish npm removal.
- `scripts/published-host/npm-packed-native.mjs` checks a clean npm consumer,
  not an npm update.

Inspect the installed UI in light/dark, narrow and keyboard layouts. Cover
native SEO and Social save scopes, images, schemas, Local SEO, indexing,
conflicts and uncertain outcomes. Inspect anonymous public HTML and route
ownership separately from previews.

Verify retained content and plugin data, a consistent database/uploads
recovery path, activation choices and queued work. Do not reset a site to
make an upgrade pass. List unexecuted or unsupported workflows in the release
notes and customer limits.

## 5. Publish and read back

Confirm the npm account, package, exact archive and intended dist-tag map.
Use the configured beta channel for prereleases; do not silently promote a
stable channel. GitHub pre-release status and npm tags are separate choices.

Publish only the qualified archive. Read back the exact version, integrity,
archive bytes and intended tags, then verify the GitHub release assets and
public install links. Record publication separately from local checks.

Keep publishing credentials out of pull-request workflows and fork jobs.
Maintain read-only CI permissions, normal branch protection and human review.
A package release does not deploy the product website or send an announcement.
