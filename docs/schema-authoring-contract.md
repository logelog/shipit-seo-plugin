# Schema authoring contract

The entry editor and Schema workspace provide guided forms for adding,
reviewing and reusing structured data. They keep separate schema records;
matching types are never merged, deduplicated or replaced automatically.
Resolved output is a prediction of this plugin's JSON-LD, not an inspection
of public HTML.

Source references below are relative to
`packages/emdash-plugin-seo/src/admin-ui/`.

## Entry schemas

Schema in use appears before the add form. Each saved record or emitted graph
has one row, ordered by source: This entry, Content type default, Shared, Site.
Source badges differ by text and style. Only This entry rows offer Edit and
Remove; other rows link to Manage in Schema. Removal requires inline
confirmation. Each row's eye control reveals its resolved JSON-LD.

Add schema provides a searchable type chooser, guided fields, an explicit
preview of the unsaved form and validation before Save schema. Enter in the
type search selects the first match without submitting the form; an empty
result is announced. Existing records open as Advanced JSON-LD, with Edit
fields available when conversion to the guided form is lossless.

Choosing a type already emitted for the entry warns that the new graph will
be separate. The warning neither changes existing graphs nor blocks an
intentional addition. The preview covers only this plugin; EmDash, the theme
and other plugins can emit additional JSON-LD.

Defaults for this entry groups the default switches and shared schemas that
were not added, with their reasons, in a collapsed disclosure. When schema
output is off, the list shows only the entry's own records and names the
disabled feature. Saving a default switch refreshes the list, preview and
graphs together. During that refresh the existing disclosure and keyboard
focus are preserved; a failed read ends the hold and reports the failure.

Owners: `EntrySchemaManager` in `content-extensions.tsx`,
`entry-schema-model.ts`, `entry-schema-authoring-controls.tsx`,
`entry-schema-authoring.ts` and `entry-schema-library-controls.tsx`.

## Workspace and Library

Schema has four tabs: Schema map, Custom schemas, Library and Defaults.
The map describes saved choices, not observed public output. The custom
schema builder has a searchable recipe list with Arrow Up/Down and Enter
navigation. It lists existing custom schemas and enabled defaults using the
chosen type as context; saving still adds a separate record.

Library stores reusable templates. A template is never applied to a page
automatically. Use template opens an independent copy in the builder, labels
the copy with its source name and changes the route from `view=library` to
`view=schema`. Later changes or deletion of the template do not affect the
copy. The workspace copy is disabled and unscoped until its scope is chosen.
The entry picker also explains copy independence.

New template is the Library's primary action. Each template uses the same
guided controls and validation as entry schemas. The `view=library` deep
link opens the Library tab through the Schema owner; it has no separate rail
item.

Owners: `SchemaView` in `configuration-views.tsx`,
`schema-composer-view-model.ts`, `schema-workspace-model.ts`,
`SchemaLibraryView` and `schema-library-model.ts`.

## Reads, conflicts and focus

A failed initial Library read shows an error view. A failed refresh keeps
the loaded list, open form, draft and unconfirmed-save notice, and adds an
alert. Until a read succeeds, Save, New template and row actions remain
unavailable; an open delete review cannot confirm. A revision conflict on
delete says that nothing was deleted. An unconfirmed write remains locked
until its outcome can be resolved.

Back from a template copy returns focus to that template's Use template
button, or the Library heading if the button is missing or unavailable.
A fresh deep link does not move focus. Focus deliberately moved by the
user is not taken away.

Close, Escape, Discard and a successful save normally return focus to New
template. If a later read resolves an unconfirmed save, focus moves only
when it has otherwise fallen to the page. When a formerly focused control
is removed, hidden or disabled, the heading receives focus after pending
work settles. A control that can still hold focus keeps it.

## Responsive forms

Type cards keep the icon beside a top-aligned text column containing the
title, description and any saved-output notice. Long text must not stretch
a neighboring card or force a label into a narrow vertical column.

Guided forms use one column when their authoring container is 480px wide
or narrower. The entry dialog also has its own 540px panel breakpoint.
Field wrappers and controls may shrink within their grid cell. Variable
source Select tracks use `minmax(0, 1fr)`, so a long selected label truncates
inside the control instead of widening the form.

## Current limits

- Creating a reusable template directly from the entry form is unavailable;
  templates are created in Library.
- Saved copies have no template identifier. The interface cannot label a
  saved record as template-derived or list all places where a template was
  used.
- Library shares the Schema configuration owner. It waits for that read and
  is unavailable when the configuration cannot be read.

## Maintainer checks

Cover source ordering and actions, duplicate-type warnings, guided and
advanced editing, independent template copies, and saved-output versus
unsaved-preview labels. Exercise failed reads, stale revisions, unconfirmed
saves and focus after Back, close and recovery. Check keyboard and screen
reader use of the type picker, plus light, dark and narrow forms.

See [editor save boundaries](editor-popup-contract.md) and
[workspace navigation](admin-navigation-contract.md).
