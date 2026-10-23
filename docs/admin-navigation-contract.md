# Admin navigation and settings

The workspace uses one route model for the rail, compact page selector,
settings search and Indexing tools. Navigation preserves drafts and never
saves settings, starts a scan or changes another plugin.

Source references are relative to
`packages/emdash-plugin-seo/src/admin-ui/`.

## Navigation

`SEO_WORKSPACE_NAV_GROUPS` in `workspace-model.ts` defines this order:

| Group | Pages |
| --- | --- |
| Overview | Overview |
| Content | Work queue, Content health, Trends |
| Search appearance | Templates, Search & social, Schema, Local SEO |
| Indexing | One Indexing rail row; tools listed within each Indexing page |
| Settings | Feature controls, Site verification, Migration when applicable, Export & import |

Schema library opens within Schema, and Website within Local SEO. Both remain
available in the compact selector and search. Migration appears after the
overview reports legacy records or migration history, while it is open, or
after it has been opened during the current admin session. Existing `view`
deep links keep their destinations.

The Indexing rail row has no disclosure or group heading. It opens the first
visible tool, normally Indexing rules. While another Indexing tool is open,
the parent row identifies that section and does not navigate on another click.

Each Indexing page starts with a labelled tool list: Indexing rules, Sitemaps,
Robots.txt, llms.txt, IndexNow, Crawl diagnostics and Redirects & 404s. The
current tool has `aria-current="page"` and a weight change as well as colour.
Tools wrap onto new rows instead of scrolling sideways. Hidden pages are
omitted consistently from the rail, tools and compact selector.

Changing a tool keeps held forms mounted, including the Indexing rules form.
It scrolls only the nearest scroll container or document when needed to bring
the workspace top into view, never an overflow-hidden host ancestor. Leaving
Indexing while focus is in its tool list moves focus to Find a setting.

Owners: `workspace-model.ts`, `workspace-shell.tsx`, `admin.tsx` and
`workspace-tabs.ts`.

## Settings search

Search matches page names and setting labels from `SEO_SETTINGS_SEARCH_INDEX`.
A setting result identifies its page and, when available, opens an enclosing
disclosure and focuses the field. For a radio group it focuses the checked
option, avoiding an accidental selection. Escape clears the search.

Unreadable-settings notices share one destination, Indexing rules
(`SEO_SETTINGS_UNREADABLE_VIEW`). The workspace banner, Overview next step
and Content health message must all open that page.

## Save, discard and restore

`SettingsActionBar` places restore at the left and status, Discard changes
and Save at the right. Save names its object, such as Save sitemap settings.
Restore requires confirmation. Discard changes returns to the loaded values
without a write.

Clean or busy Save and Discard controls use `aria-disabled` and ignore
activation while retaining keyboard focus. Save also cancels form submission
when unavailable. Its loading icon is decorative, preserving the accessible
button name. A disabled control's focus ring remains visible.

| Page | Restore | Save |
| --- | --- | --- |
| Search & social | Restore inherited | Save search & social settings |
| Website | Restore inherited | Save website settings |
| Indexing rules | None | Save indexing rules |
| Feature controls | Restore inherited | Save modules |
| Schema defaults | Restore inherited | Save presets |
| Sitemaps | Restore defaults | Save sitemap settings |
| Robots.txt | Restore default | Save robots.txt |
| Templates | Use inherited | Save template |

Sitemaps and Robots.txt cannot restore when nothing is stored, even if an
unsaved draft exists. Templates can use inherited values only when the
content type has a saved template and no unsaved edits.

Feature controls writes and restores include the module record's observed
`expectedRevision`, or null when absent. Compare-and-set refusal writes
nothing and retains the switches until Reload latest or Discard changes
reads the record again. A host without conditional storage reports
`writable: false`; editing, Save and Restore remain unavailable.

For Search & social, Website, Indexing rules, Sitemaps and Feature controls,
an unknown write outcome reads Save not confirmed. The draft and write lock
remain until a successful reload resolves the saved state. A failed reload
keeps the form and recovery notice; it does not replace a loaded form with
the initial error view. Sitemaps and Feature controls keep the draft if the
returned revision is its original revision, otherwise adopt the newer record.
A definite refusal is distinguished from timeout, conflict and rate limit.
No write retries automatically.

Owners: `settings-action-bar.tsx`, the settings containers in `admin.tsx`,
`configuration-views.tsx`, `sitemap-view.tsx`, `robots-txt-view.tsx` and
`template-views.tsx`.

## Session drafts

Search & social, Website and Indexing rules keep overrides in the workspace
owner. Schema remains mounted once visited. Templates, Local SEO and custom
verification tags use stores outside their page.

Feature controls, Sitemaps, Robots.txt, llms.txt, IndexNow and Site
verification use `useWorkspaceDraftHold`. A page holding edits, an in-flight
write or an unresolved outcome remains mounted and hidden on navigation.
It retains the draft, starting revision and recovery state, but closes its
dialogs. A clean page may unmount and read its saved state next time.
Navigation never retries or discards work; leaving or reloading the admin
drops these session drafts.

## Page behavior

**Templates.** Up to four content types use a vertical selector beside the
fields when the form is at least 600px wide; otherwise a Select is used.
With more than four types the Select is always used. Each type retains its
draft and an edited marker. Variable chips insert at the last focused field's
caret, replacing a selection and returning focus after the token; SEO title
is the initial target. Only a settled Preview supplies per-field examples.

**Feature controls.** Saved-on modules offer Open links to their workspaces;
pending switches do not change those links. The module form is labelled Save
to apply. Automatic & bulk analysis and Publisher schema & Local SEO identify
their immediate-save behavior.

**Overlapping plugins.** Feature controls lists each active overlapping plugin
once, its version, assessment and the features paused in Shipit. Manage plugins
opens the host's plugin page; Check again refreshes the inventory. The plugin
never deactivates another plugin or imports its data. Compact notices appear
only on affected output pages: metadata on Search & social and Templates,
robots meta on Indexing rules, schema on Schema and Library, and IndexNow.
Overview also offers Review. Sitemaps and Robots.txt are not coexistence
surfaces. Notices share one inventory read per admin document; Feature
controls and Check again explicitly refresh it.

**Site verification.** Provider inputs show a live tag preview from their
draft values. Save Google and Bing codes and Save custom tags name their
separate stores. Discard changes for the native codes restores their loaded
values without writing. The native fields link to EmDash's own SEO settings
because both interfaces edit the same values.

**Overview.** Setup details is open by default and contains setup actions,
rather than duplicating the settings pages in a second card grid.

Owners: `template-views.tsx`, `template-editor-model.ts`,
`plugin-coexistence-view.tsx`, `plugin-coexistence-model.ts`,
`site-verification-view.tsx`, `custom-verification-view.tsx` and
`overview-view.tsx`.

## Responsive and accessible controls

Container queries respond to the workspace width, after the host sidebar and
rail have taken their space. Work queue filters stack at 840px and become
one column at 560px. At 700px, Sitemaps places its status panel below the
form. At 560px, Feature controls stacks row controls, Local SEO stacks review
facts, and tool tabs wrap with a visible active indicator. Review grid
tracks use `minmax(0, 1fr)`.

Indexing radio legends name the item, such as Search visibility for Posts.
The llms.txt switch identifies its saved state. A settings save reports
beside its action rather than through a duplicate toast. External-link icons
stay beside their text, and long addresses may break after a slash.

## Maintainer checks

Exercise deep links, the compact selector, settings search and focus, hidden
pages and all Indexing tools. Move between pages with unsaved drafts and an
unconfirmed save, then return. Verify restore confirmation, revision refusal,
failed reload, one primary action and no unintended write.

Check light and dark themes, keyboard use, and narrow workspace widths without
page overflow or inaccessible tabs. See [editor layout](editor-layout-contract.md)
and [Local SEO and Indexing](local-seo-indexing-contract.md) for page-specific
contracts.
