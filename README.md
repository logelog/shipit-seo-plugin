# Shipit SEO

SEO tools for native EmDash: search and social previews, content checks,
structured data, Local SEO and indexing controls.

## Get started

Try the beta on a copy of your site, using its existing package manager:

```sh
npm install --save-exact @shipitseo/emdash-plugin-seo@beta
```

The command saves the resolved beta version exactly. Follow the
[installation guide](packages/emdash-plugin-seo/INSTALL-PROMPT.md) to connect
the existing EmDash integration and templates, then check a published page.

The [package guide](packages/emdash-plugin-seo/README.md) covers everyday use.
Use the [indexing guide](docs/indexing.md) to check public files and IndexNow
submission results.
See [upgrading](packages/emdash-plugin-seo/UPGRADE.md) and
[removal](packages/emdash-plugin-seo/UNINSTALL-PROMPT.md) before changing an
existing installation.

## Compatibility

<!-- compatibility:support:start -->
Native EmDash/admin support: **1.3.1 or 1.3.0**.
Use Node **24.19.0**, Astro **7.3.2** and SQLite.
<!-- compatibility:support:end -->

This beta is for native Node/SQLite sites. See the
[compatibility matrix](docs/compatibility.md) for checked host combinations and
verification coverage. Cloudflare Workers/D1, Postgres and sandbox/registry
installation are not verified. The [package limits](packages/emdash-plugin-seo/README.md#limits)
cover workflows that still need testing.

## Contribute

Bug fixes, documentation, tests and translations are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks,
[GOVERNANCE.md](GOVERNANCE.md) for project roles, and the
[roadmap](docs/roadmap.md) for planned work.

Pull requests run **Repository quality**, which checks public-file hygiene,
translations and contributor tooling without installing EmDash. The manual
**Native checks** workflow runs the current native build, types and
selfchecks. Release qualification is a separate maintainer task; CI does not
publish packages or deploy sites.

Use [Issues](https://github.com/logelog/shipit-seo-plugin/issues) for reproducible
bugs and [Discussions](https://github.com/logelog/shipit-seo-plugin/discussions)
for questions and ideas. Read [SECURITY.md](SECURITY.md) before reporting a
vulnerability and [SUPPORT.md](SUPPORT.md) for useful report details.

## License

[MIT](LICENSE). Schema.org vocabulary data has separate terms in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
