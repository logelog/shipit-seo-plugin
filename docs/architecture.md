# Architecture

Shipit SEO runs as a native plugin inside EmDash's trusted host process.
The Astro wrapper connects the plugin, its admin UI and public-route
integration. It does not provide sandbox isolation or replace the site's
adapter, database or templates.

<!-- compatibility:development:start -->
The default development target is **native-1.3.1** (EmDash/admin 1.3.1).
Use Node **24.19.0**, pnpm **11.19.0**, Astro **7.3.2** and SQLite.
The fixture is `integration/emdash/published-host-1.3.1`.

Retained native targets: `native-1.3.0`.
The current target implements quick verification; full verification is not implemented for this target.
<!-- compatibility:development:end -->

## Source map

Paths below are relative to `packages/emdash-plugin-seo/`, unless noted.

| Area | Owner |
| --- | --- |
| Astro installation and branding | `src/astro.ts` |
| Native plugin registration | `src/native-entry.ts`, `src/index.ts` |
| Runtime hooks and public output | `src/sandbox-entry.ts` |
| Shared admin requests and responses | `src/admin-contract.ts` |
| Scoring and checklist presentation | `src/analysis.ts`, `src/check-presentation.ts` |
| Search-preview measurements | `src/snippet-metrics.ts` |
| Workspace and editor UI | `src/admin-ui/` |
| Bundled translations | `src/admin-ui/i18n/` |
| Package contents and links | `scripts/packed-artifact.mjs` |
| Contributor tasks | repository `tooling/plugin-dev/` |
| Pinned-host verification | repository `scripts/published-host/` |

Selfchecks live beside the relevant engine and admin source. Integration
fixtures have their own manifests and locks; they are not customer templates.

## Ownership and saves

Website defaults, publisher identity, content-type templates and entry
overrides are separate records. Settings and schema writes use observed
revisions and retain drafts on conflicts or uncertain outcomes. A navigation
action neither saves nor discards a form.

EmDash owns native title, description, canonical, indexing and custom image
fields. Native SEO saves, Social text saves and the host content draft have
separate timing and revision checks. The plugin cannot synchronize the host's
private write token. Public templates still own the document title and must
provide the correct entry and locale to `EmDashHead`.

See the [editor popup](editor-popup-contract.md),
[editor layout](editor-layout-contract.md) and
[navigation](admin-navigation-contract.md) contracts for detailed behavior.

## Analysis

`analysis.ts` computes assessments and `check-presentation.ts` decides their
groups, wording, counts and score display. Every surface uses those modules.

Browser checks use saved content already loaded for the editor and local
keyword input. They do not run manual server analysis or store history.
Saved assessment profiles override the browser defaults; Posts use Article
checks by default, while Pages and custom types use General content.

Custom blocks use explicit, versioned field mappings from the site's Astro
configuration. The shared projector reads declared saved prose, headings,
links and images; it does not recursively collect arbitrary strings. The
entry preview carries the selected mapping to the browser, protected by the
same entry, saved-version, ownership and locale checks. Captured server inputs
retain the mapping across replay and include it in freshness identities.
Unknown mapped content keeps dependent checks incomplete.

Manual analysis is an explicit privileged operation. Automatic analysis,
history and bulk scans require activation and resource-use acknowledgement;
a scan additionally needs Start. Upgrades do not start catch-up analysis.
Versioned input identities mark older results stale or earlier without
rewriting their stored history. See the
[score contract](score-checklist-contract.md).

## Public output

The runtime combines the site's settings and current entry with the host page
context. The theme owns its title, templates and route registration. Shipit
adds metadata, structured data and public-file contributions only within
their respective ownership rules.

Site-wide and content-type restrictions only add noindex. Taxonomy archive
rules require an explicit template binding and do not alter assigned posts.
Sitemap exclusions do not add noindex. See
[Local SEO and indexing](local-seo-indexing-contract.md).

Custom schemas are additive; library templates create independent copies.
Preview predicts Shipit's contribution for the saved entry, not the complete
rendered page. See [schema authoring](schema-authoring-contract.md).

Branding is site configuration, not a database setting. The adapter validates
the optional third wrapper argument; technical plugin/package identifiers
stay stable. See [admin branding](white-label-contract.md).

## Optional effects and distribution

Analysis and IndexNow have separate activation controls. Opening a page does
not acknowledge costs or send provider requests. Per-operation bounds limit
work but do not impose a hosting spending cap.

The customer package uses an explicit file allowlist and packed-artifact
checks. It includes runtime code, declarations, styles and customer guides,
without contributor fixtures, local data or reports. Native Node/SQLite
coverage does not establish support on another host; see
[compatibility](compatibility.md) and [releasing](releasing.md).
