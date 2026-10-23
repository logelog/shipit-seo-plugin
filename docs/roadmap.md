# Roadmap

Shipit SEO is stabilizing its native beta before a 1.0 release. The current
supported combinations and verification limits belong in
[Compatibility](compatibility.md). This roadmap describes planned work;
it does not expand that support matrix or set release dates.

## Beta focus

Use reports from real installation and editing workflows to prioritize fixes:

- Make single-entry analysis, focus keywords and search/social previews clear
  and consistent. Basic browser checks and previews must remain available with
  optional server analysis off.
- Stabilize native metadata ownership, image inheritance, schema editing and
  indexing controls, including conflict and uncertain-save recovery.
- Keep install, update, disable, removal and rollback instructions matched to
  the exact package. Preserve data by default and verify recovery on a copy.
- Fix reproducible usability and reliability problems before adding hosting
  targets or expanding optional background work.

Hosting-aware onboarding and the additional hosting profiles below are outside
the current beta.

## Planned work toward 1.0

### Setup that understands the hosting target

A first-install guide should ask where the site runs and, where relevant,
which hosting plan it uses. It should explain the available capabilities,
recommended defaults and any unsupported operations before applying settings.

Cloudflare Free and Paid need separate capability profiles, feature defaults
and interface guidance. Selecting a paid plan must not enable bulk analysis,
outbound submissions or other potentially costly work automatically. Changing
a selection later must recheck capabilities and preserve existing content and
settings; a selection alone is not proof of the actual deployment environment.

Acceptance requires first-install and existing-site flows, clear reasons for
unavailable features, and successful cancel, correction and recovery paths.

### Cloudflare runtime and resource qualification

Qualify Workerd and D1 behavior on the actual provider runtime, separately for
each supported plan. Measure request work, database reads and writes, batch
sizes, interruptions and recovery using representative synthetic sites.
Use current provider limits and measured results to choose the defaults.

Free must not mean guaranteed zero cost, and Paid must not mean unlimited
capacity. Show the scope and limitations of resource controls. A feature toggle
cannot guarantee a hosting bill, and optional outbound work still needs an
explicit user action.

### Predictable analysis and recovery

Keep basic single-entry analysis and previews available independently of
optional server analysis. Optional bulk work needs bounded batches, visible
progress, cancellation and safe resume. A partial run must show its coverage
without presenting the result as a whole-site assessment.

Test feature guards, saved-score freshness, conflicting edits and uncertain
writes across each qualified target. Updates must preserve data and optional
feature choices. Rehearse rollback with consistent backups and explain where
an earlier version cannot safely read newer data.

### Additional targets

Treat other hosting environments, Postgres and sandbox execution as independent
qualification work. Each needs its own dependency graph, storage/runtime checks,
installation path and recovery evidence. Native Node/SQLite results do not
qualify them. An unverified target stays outside the supported matrix, including
at 1.0; this roadmap does not promise that every target will ship together.

## Later: GEO and crawler visibility

Explore an optional read-only Cloudflare API connection and a dedicated GEO
analysis screen for observed bot and AI crawler traffic. Keep credentials
server-side with the least permissions needed, and show the observation period
and coverage. Bot visits do not establish AI citations, indexing or rankings.
Track this work through focused roadmap issues after beta stabilization.
The connector and interface are future work; this plan enables no integration,
data collection or provider charges.

## Gates for a stable release

A 1.0 candidate needs evidence for its exact source and package on every
advertised target. Complete the relevant runtime, public-output, installation
and recovery checks, together with light/dark, narrow-layout, keyboard,
save/error and conflict flows. Keep known limits visible in the compatibility
matrix, interface and customer guides.

Resolve release-blocking defects from beta feedback. Maintain the contribution
and review process in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[GOVERNANCE.md](../GOVERNANCE.md) as work progresses.

## Beta feedback

Use reproducible installation, editing and recovery reports to guide beta
stabilization. Include the plugin and host versions, expected behavior and a
small synthetic reproduction. Questions and feature proposals belong in
Discussions; confirmed bugs belong in Issues.

The beta's admin name/logo configuration is available now. A broader
white-label experience for agency and client projects is planned toward 1.0.
Technical identifiers and required notices remain distinct from branding.

Release notes and announcements should link to the current package, guides,
compatibility scope and feedback channels. Publication, website deployment
and an announcement are separate steps.
