# Security policy

## Report a vulnerability privately

Use **Security > Report a vulnerability** in
[logelog/shipit-seo-plugin](https://github.com/logelog/shipit-seo-plugin/security/advisories/new).
If the private reporting option is unavailable, email **info@shipitseo.com**.
Do not disclose vulnerability details in public issues, discussions or pull
requests.

Include the affected version, relevant configuration, required permissions,
reproduction steps with synthetic data and the observed impact. Remove
credentials, tokens, session data and personal information. Test only systems
you own or have permission to assess. No response-time commitment is offered
during beta.

## Supported versions and scope

Only the latest published beta is maintained; older betas do not receive
separate security backports. Reports affecting older versions are welcome,
but the maintainer may ask you to check the latest beta.

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

The plugin runs in the trusted host process; it is not
a sandbox boundary. Cloudflare Workers/D1, Postgres and sandbox installations
have not completed this beta's verification. This limits support claims, not
whether a security issue can be reported.

Relevant concerns include unauthorized settings or content changes, unsafe
metadata or schema output, disclosure of stored secrets and unintended
outbound requests.
