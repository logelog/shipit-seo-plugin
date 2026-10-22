# Release checklist

Use this checklist for each native npm release candidate. A publishable
manifest does not mean its final archive has passed acceptance.
Existing results for a provisional archive must not be assigned to a new one.

## Version and compatibility

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

Update [compatibility.json](../compatibility.json), synchronize its current
documentation and check the derived pins as described in
[compatibility.md](compatibility.md). A declaration does not establish acceptance.

- Record the proposed version, immutable reviewed commit and clean source state.
  Never reuse a published version for changed bytes.
- During `0.x` and beta development, describe breaking behavior and storage
  changes in every affected release; do not imply safe unattended updates.
  For a future stable series, use major versions for breaking changes, minor
  versions for compatible additions and patches for compatible fixes.
- List qualified EmDash/admin, Astro, Node and database versions, tested update
  pairs, any required manual steps and downgrade limits. Retain separate
  installed-package evidence for every declared supported target.
- Keep data retention the default. A release must not silently reset indexing,
  purge records, enable optional work or treat an export as a database backup.
- Use `beta` only for reviewed prereleases. A channel label can move; customer
  instructions must resolve and pin an exact version. Stable `latest` promotion
  requires a separate policy and package-guard change, not a renamed label.

## Freeze and identify the customer archive

- Before freezing, set the release version in `package.json` and
  `SEO_ENGINE_VERSION` (`src/admin-contract.ts`), the install pins in README,
  UPGRADE and INSTALL-PROMPT, and the release wording: the README and UPGRADE
  introductions, the INSTALL-PROMPT target line and a CHANGELOG heading without
  a candidate label. The archive ships these files, so candidate or
  "after publication" wording must not reach it. List the tested update paths
  and every unverified path in UPGRADE.
- Run the relevant full verification with the pinned dependency graph and record
  `pnpm dev:report`. Review all changed customer guidance, dependency differences,
  public-file boundaries and third-party notices.
- Create the candidate once, then record its exact filename, version, byte size,
  SHA-256, source commit and host lockfile hash. Record the Node and package-manager
  versions. Receipts must identify that same archive and target.
- Check compiled exports, styles, declarations, license, notices and packaged
  links, including README, installation, upgrade, removal and changelog files.
  Keep development sources, fixtures, maps, secrets and local state out.
- Run the packed, brand-neutral and install-pin checks against the frozen tgz
  itself: extract it, run `assertPackedArtifact` and `assertBrandNeutralArtifact`
  from `scripts/packed-artifact.mjs` on the extracted package, and check that
  every `@shipitseo/emdash-plugin-seo@<version>` in README, UPGRADE and
  INSTALL-PROMPT names the archive's version. `scripts/check-packed.mjs` packs
  from source again, so its result does not identify the frozen archive. Keep
  the receipt with the archive's SHA-256.
- If source, manifest, compiled output or customer documentation changes, bind a
  new candidate and rerun affected acceptance checks. A source preview or an old
  archive's green receipt cannot approve the replacement.

## Installation, update and recovery evidence

Run heavy checks serially with previews stopped. Use synthetic data and copies;
keep IndexNow delivery off and verify that no provider request is sent.

- Check the exact archive with the documented npm and pnpm consumer paths.
  Record installation, predecessor-to-candidate update and removal/reinstallation
  separately for each package manager; one does not establish another.
- Full verification never reaches the registry: run it in a loopback-only
  network namespace. Both packed consumers install offline; the pnpm consumer
  uses the host graph's recorded store. The npm consumer runs only when
  `SHIPIT_NPM_OFFLINE_CACHE` names a prepared npm cache holding every package
  of the consumer; the check copies it and installs with `npm install --offline`.
  Without it the step records `not-run`, the verification receipt lists it under
  `notRun`, and CI evidence refuses the run (`checks-not-run`). A not-run check
  is a tooling limit, never a passed check. Preparing such a cache needs the
  registry once and its own approval.
- Use `scripts/published-host/package-upgrade-recovery.mjs` for exact previous and
  candidate archives. Its released-runtime lifecycle, retained records and full
  SQLite recovery checks use the pinned host graph; this script does not perform
  package-manager installation or render public HTML. Before its baseline
  analysis it acknowledges the resource-use notice, turns saved-content
  analysis on and saves an Article profile for posts, then turns analysis off
  again; `0.4.0-beta.39` and later predecessors refuse analysis without them.
  A predecessor that refuses this seed needs its own check.
- Use `scripts/published-host/native-removal-smoke.mjs` for the actual pnpm
  dependency-removal, build, public-fallback and reinstallation flow. It does not
  establish an npm removal result. Clean npm installation through
  `npm-packed-native.mjs` also does not establish npm update or removal.
- Both scripts map `virtual:emdash/dialect` to the pinned host's SQLite
  `createDialect` beside `virtual:emdash/config`; the removal smoke gets it
  from `native-removal-lifecycle.mjs`. Without it the host's `getDb()` fails
  outside a request and the plugin pauses its metadata, robots, schema and
  IndexNow output. Only a receipt from these scripts in the reviewed source
  counts, not one from an edited copy.
- Record any additional real package-manager update check independently. Keep
  manifests, lockfiles, configuration, activation state and SQLite/WAL-aware
  recovery evidence matched to the update pair. Check retained core and plugin
  data, saved revisions, stale-score status and optional-work settings.
- Review the installed admin in light/dark and narrow layouts: keywords,
  checklist, readable previews, native SEO ownership and independent saves,
  schemas, Local SEO and image inheritance. Inspect anonymous public output,
  routes, indexing restrictions and cache behavior separately from previews.
- The general `pnpm verify` lane does not run the standalone upgrade/recovery or
  removal scripts. Record their separate results. A failed or unexecuted required
  check remains open; disclose unsupported paths rather than borrowing evidence.

Cloudflare Workers/D1, Postgres, sandbox/registry installation and live IndexNow
provider acceptance remain unverified for this candidate. Native SQLite evidence
must not be extended to those targets or to cancellation of in-flight requests.
Disclose each unverified path in the customer documents. Installation,
package-manager updates, removal and editor locale switching need their own
evidence; one passing path does not qualify another.

## Public source and contribution readiness

The public repository and npm package have different contents. The repository
needs source, tests and contributor tools; the npm archive uses the package's
`files` allowlist. An archive check does not approve the public source tree.

- Prepare the public tree from a reviewed snapshot in a separate, empty staging
  directory. Copy only the reviewed root files and `.github`, `docs`,
  `packages/emdash-plugin-seo`, the fixtures selected by `compatibility.json`,
  `scripts` and `tooling/plugin-dev`. Include the pinned manifests and lockfiles
  needed for those paths. Any added target needs its own reviewed file list.
- Do not copy the private checkout's `.git` directory, history, refs, remotes,
  hooks, configuration or ignored files. Start the public repository with fresh
  history. Do not export old candidate archives, private delivery records,
  local instructions, handoffs, database snapshots, sessions or user uploads.
- Inspect the complete staged file list, then run `pnpm check:public` in that
  staged tree. It checks tracked and nonignored source files for known sensitive
  patterns; it is not a guarantee that all secrets or personal data are absent.
  Review text, example data, images and image metadata separately, using
  synthetic content. Review the final source diff and npm archive contents too.
- Keep the MIT license and third-party notices in both appropriate artifacts.
  Keep `CLA.md`, CONTRIBUTING and the PR template consistent about the agreement
  version. Before merging, obtain each contributor's explicit acceptance and
  record the agreement revision. A checkbox is not a verified signature;
  signing automation is not configured. Do not collect identity documents or
  personal addresses in a public pull request.
- Verify that GitHub private vulnerability reporting is enabled on the public
  repository and that SECURITY names the actual process and supported-version
  policy. The initial beta uses this channel; do not substitute an untested
  mailbox or imply that notification delivery has been tested.
- Check the actual hosted results for the reviewed commit. **Repository quality**
  runs public-file, translation and development-tooling checks without installing
  EmDash. It does not establish product or installed-package acceptance.
- [Native checks](../.github/workflows/native-checks.yml) is a manually
  dispatched source check for the current compatibility target. It runs the
  package build, type checks and selfchecks. It has no push or pull-request
  trigger and does not publish packages or deploy sites. Full release
  qualification and exact-archive acceptance remain separate. The reference
  workflows under `docs/ci` are inactive examples. Before changing a native
  lane, review its locked dependency graph, install scripts, token permissions
  and fork behavior. Keep fork checks read-only and publishing credentials
  out of PR jobs.
- Full verification requires a prepared SHIPIT_NPM_OFFLINE_CACHE; missing cache
  remains a not-run failure for release evidence. Do not turn a skipped check
  into a pass or describe quick checks as full verification.
- Verify main protection against the policy in GOVERNANCE.md after its first
  successful hosted check. Require the actual check name, resolved conversations
  and linear history. Block force pushes and deletion. CODEOWNERS only requests
  review; it does not enforce GitHub settings by itself.
- Keep package publication separate from pull-request CI. Do not publish from a
  fork or grant pull-request jobs access to npm credentials. Review the exact
  archive and beta channel before any first publication.
- Finish the product site and its install, update and removal links before npm
  publication. Use screenshots from the accepted archive and state the tested
  host, runtime and storage scope accurately. A website build alone is not
  acceptance of its content or deployment.

## Publish and verify

- Obtain maintainer acceptance of the exact commit/archive pair and its stated
  limits. Confirm the intended npm account, package, version and channel.
- Publish only the accepted archive through the authorized release process;
  this checklist does not publish or configure publishing credentials.
- Read back registry version, integrity and channel, and check the public source
  and customer links. Record the publication result separately from local checks.
  Retain the accepted archive, receipts and recovery instructions.
