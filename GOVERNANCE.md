# Shipit SEO governance

Shipit SEO is a SHIPIT project led by a Project Lead, with a Project Team and
Maintainers. Contributors can take on broader responsibilities as their work
and interest in the project grow.

The role lists in this document define project membership. Repository access,
review requests and publishing credentials are separate capabilities; they do
not make someone a Maintainer. Automated accounts cannot hold project roles.

## Current team

### Project Lead

- [@logelog](https://github.com/logelog)

### Maintainers

- [@logelog](https://github.com/logelog)

### Other Project Team members

None appointed yet. Maintainers are also Project Team members.

## Work and decisions in public

Use GitHub Discussions for questions, ideas and early proposals, issues for
defined problems, and pull requests for reviewable changes. Product direction,
architecture, roadmap and contribution policy should have a public record in
the relevant discussion, issue or pull request.

Private chats and calls can help coordinate work. Record their substantive
conclusions on GitHub so participation does not depend on attending a call or
belonging to a private channel. Use private channels for security disclosures,
conduct reports, individual appointments, credentials and confidential matters.

Discuss a substantial behavior change before implementing it. Small, focused
fixes can go directly to a pull request. Explain the user problem, proposed
behavior and constraints, and keep review feedback constructive.

## Project roles

### Contributor

Anyone can report a bug, improve documentation, translate the interface,
review a proposal, help another user or submit code. Contributions do not
require repository access or membership in the Project Team. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the fork and pull request workflow,
verification and contributor agreement.

A person becomes a Contributor when their first pull request is merged.
That pull request can contain code, tests, documentation or a translation.
Before that first merge, they are welcome to participate and propose changes.
Contributor status recognises accepted work; it grants no repository access
and does not automatically lead to another project role.

### Project Team

Project Team members are trusted regular contributors who help run the project.
Their work can include code, documentation, translation, design, support,
reviews and community participation.

Project Team members can:

- help classify issues and discussions and identify duplicates;
- help contributors refine a proposal or find the right process;
- coordinate reviews and handoffs;
- provide technical and product feedback on pull requests; and
- participate in planning and governance discussions.

Membership does not grant merge or release authority. A Project Team review
helps a Maintainer assess a change; it is not a Maintainer approval. Any ability
to change labels, close issues or manage discussions is granted separately.

### Maintainer

Maintainers are Project Team members trusted to review and merge changes and
apply the project's policies consistently. They:

- share the Project Team's responsibilities;
- review and merge changes that meet the contribution and verification rules;
- accept or decline work within agreed scope and explain the decision; and
- share responsibility for compatibility, security, release quality and the
  contributor experience.

Merge access does not automatically include package publishing, release
management, repository administration, production access or secrets. Grant
those capabilities only for an agreed responsibility.

### Project Lead

The Project Lead is a Maintainer accountable for the project's direction and
governance on behalf of SHIPIT. The Project Lead:

- seeks public input on product, architecture, roadmap and governance changes;
- consults active Maintainers and makes the final decision when review does
  not reach agreement;
- appoints Project Team members and Maintainers after consultation;
- manages repository administration and privileged access; and
- can act immediately to protect the project during a security, conduct or
  operational incident.

Routine work within accepted scope does not need separate Project Lead
approval. When the Lead is unavailable, they can name a Maintainer to handle
specific responsibilities and record the scope of that delegation.

## Joining and progressing

Anyone can express interest in joining the Project Team or suggest someone.
A candidate should have made useful contributions over time, shown constructive
judgment and collaboration, and want ongoing responsibility. Code is one form
of contribution; documentation, translation, triage, reviews, design and
support also count. Participation in a chat service is not a requirement.

A Maintainer normally sponsors the candidate. Active Maintainers can raise
relevant concerns privately, and the Project Lead makes the appointment.
Announce accepted appointments publicly and update this document. Keep private
concerns and unsuccessful nominations out of public threads.

The Project Lead, **@logelog**, selects and appoints Maintainers. The Lead can
invite a candidate or consider a suggestion from the community, consulting
active Maintainers as appropriate. Useful evidence includes sustained ownership,
work beyond the candidate's own changes, sound review judgment and consistent
attention to compatibility, security and project scope. Appointments take
effect after the candidate accepts the responsibilities and the team list is
updated.

There is no automatic promotion to Project Team or Maintainer, regardless of
the number of merged pull requests. Team size should reflect work people want
and are able to take on, with more selective appointments where merge or
publishing access is involved.

## Participation and access

Project members can take breaks or step down without a minimum time or commit
requirement. After roughly six months without meaningful participation, the
Lead or another Maintainer should check in privately. Members can keep a role
during an agreed break, move to a less privileged role or be recognised as
former members. Remove access that is no longer needed. Returning members
can use a short reappointment review that confirms current interest and access
needs while recognising previous work.

Review privileged access at least annually and when responsibilities change.
Review repository access, package publishing, releases, infrastructure and
secrets separately. A project role is not a permanent grant of every capability.

This repository belongs to a personal GitHub account. Project Team membership
is a role recorded here, not a GitHub organization team. It does not create
organization roles or automatically assign granular triage access. Contributors
can participate through forks, issues, discussions and reviews without write
access. Repository capabilities remain the owner's separate responsibility.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in community participation and
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
