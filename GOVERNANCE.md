# Project governance

## Maintainer

Shipit SEO is maintained by **@logelog** for SHIPIT. The maintainer reviews and
merges contributions, manages repository access and publishes releases.
[CODEOWNERS](.github/CODEOWNERS) identifies the current review owner.

## Contributions and decisions

Anyone can report a bug, propose an idea, improve documentation, translate the
interface or submit a pull request. Read [CONTRIBUTING.md](CONTRIBUTING.md) for
setup, checks and the existing contributor agreement.

Use an issue or discussion for a substantial behavior change before spending
time on an implementation. Small, focused fixes can go directly to a pull
request. Explain the user problem, proposed behavior and relevant constraints.
Record decisions where contributors can follow them.

The maintainer makes final scope and release decisions. A requested change
may need revision or may be declined; explain that decision in the issue or
pull request. Passing checks alone do not authorize a merge or release.

## Access and responsibilities

Contributing does not require write access. Contributors work through forks
and pull requests. Review requests, labels and contributor agreement acceptance
do not grant repository permissions.

If the maintainer adds reviewers or maintainers, update this document and
CODEOWNERS to describe their responsibilities. Keep permissions limited to
the work each role needs.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in public participation. Use
[SECURITY.md](SECURITY.md) for private vulnerability reports.
## Main branch and releases

Changes after the initial import go through a pull request. Main requires the
Repository quality check, a branch up to date with main, resolved conversations
and linear history. Force pushes and branch deletion are blocked, including
for administrators. Merges use squash commits.

There is currently one maintainer. CODEOWNERS requests their review, and they
review external contributions before merging. No independent approval count
is enforced yet, so owner-authored changes are not described as independently
approved. Add an independent required reviewer when a second maintainer can
review owner-authored changes without blocking maintenance.

Repository quality covers public files, translations and development tooling.
Product changes still need the relevant native and installed-package checks
in CONTRIBUTING. Passing PR checks does not authorize npm publication.
The release checklist in docs/releasing.md keeps the archive, acceptance
evidence, beta channel and publication decision separate.
