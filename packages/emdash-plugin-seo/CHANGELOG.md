# Changelog

## 0.4.0-beta.57

- Keep scores below the Good band until a focus keyword is set. Missing
  keyword checks no longer allow a perfect score by omission.
- Reject inconsistent keyword evidence in current results and keep earlier
  analyzer results separate from current scores.
- Analyze custom content blocks through explicit, versioned field mappings in
  the site configuration. Editor and server checks share extraction and keep
  unknown or incomplete content unscored.
- Read declared body fields in automatic editor checks, and invalidate saved
  results when their content mapping changes.
- Complete IndexNow key creation, verification and activation from one action.
  First Astro setup can reuse a valid key at the default site-owned file and
  resume after a failed check. Manually configured keys, custom locations and
  keys from previous activations stay unchanged.
- Explain blocked or missing IndexNow key files, redirects, invalid responses
  and mismatched keys without enabling delivery on a failed first setup.

## 0.4.0-beta.56

- Commit a bulk-analysis score and its outcome receipt atomically on D1, with
  revision checks for the content, settings and scan owner.
- Keep taxonomy and internal-link queries within D1's parameter limit.
- Include fixed content routes, such as the homepage, in sitemaps after checking
  that each locale has a single published entry. Conflicting routes stay excluded.

## 0.4.0-beta.55

Prepare the native beta with synchronized compatibility and installation
guidance. SEO checks and native integration behavior are unchanged from
beta.54. See README.md for the supported scope and UPGRADE.md for the
limits of historical update and removal checks.

## 0.4.0-beta.54

Initial public beta source for native EmDash and admin 1.3.0 or 1.3.1 on Node
with SQLite.

- Edit search and social metadata with native field ownership, image inheritance
  and guarded saves.
- Check saved entries in the browser without enabling optional server analysis.
  Posts default to Article checks; other content types use General content
  unless a profile is configured.
- Review focus keywords, search/social previews and a weighted checklist score.
  Article length and short-sample keyword rules are editorial guidance, not
  search-engine requirements or a ranking prediction.
- Configure structured data, shared schema templates, Local SEO and indexing
  rules, with separate controls for optional analysis and provider requests.
- Explore sitemap entries with file selection, search, status filters and
  bounded pages. Start content and rendered diagnostics explicitly.

See README.md for supported platforms and UPGRADE.md for historical tested
update pairs, data retention and recovery. Earlier development candidates
were not published to npm.
