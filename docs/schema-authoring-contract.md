# Schema authoring contract

## Scope

Make adding, reviewing and reusing schema possible without writing JSON, in the
entry editor's Schema tab and in the Schema workspace, without changing the
stored data model. Covers design items S1 (Schema in use first), S2 (Library as
a Schema tab) and S3 (searchable type list). Existing graphs, revision
protection, unsaved drafts and independent saved copies are unchanged. Nothing
is deduplicated, merged, deleted or re-identified automatically.

Paths are relative to `packages/emdash-plugin-seo/src/admin-ui/`. References
name symbols or quoted strings to search for, not line numbers. "Before"
describes the pre-change candidate; "Now" is this change.

## Requirements

### (a) Adding a normal schema needs no JSON

| Part | Before | Now |
|---|---|---|
| Type selection | Entry and template: a five-tile grid, no search (`EntrySchemaAuthoringControls`). Workspace guided builder: a plain Select of eight recipes (`SchemaView` in `configuration-views.tsx`) | Entry and template chooser gains "Search schema types"; Enter picks the first match and never submits the form; no match shows "No schema type matches" (`EntrySchemaAuthoringControls`). Workspace builder: `SchemaTypePicker` in `configuration-views.tsx`, rendered by the `SchemaView` composer, a search field driving a one-column list with one-line recipe descriptions, Arrow Up/Down and Enter (filter and key model `filterSeoSchemaComposerRecipes` and `moveSeoSchemaComposerHighlight` in `schema-composer-view-model.ts`) |
| Type-appropriate form | Satisfied: guided fields per type (`entry-schema-authoring-controls.tsx` `renderField`; `entry-schema-authoring.ts` `FIELDS`); workspace recipes (`configuration-views.tsx` composer fields) | Unchanged |
| Preview and validation | Satisfied: explicit Preview of the unsaved form (`EntrySchemaCandidatePreview` in `entry-schema-library-controls.tsx`), save gate `entrySchemaEditorCanSave` (`entry-schema-model.ts`); workspace draft JSON-LD and composer validation | Unchanged |
| Add to this entry | Satisfied: Save schema writes this entry's own record (`content-extensions.tsx` `save`) | Unchanged |
| Save as reusable template | Library tab only (New template, same guided controls) | Unchanged; from the entry form it is **open** (below) |
| Edit and remove an added schema | Satisfied: pencil and trash on each entry row, removal confirmed inline in the row (`content-extensions.tsx` `openStoredSchema`, `renderRemovalConfirmation`). Edit opens Advanced JSON-LD with an explicit "Edit fields" action when lossless | Kept on the entry rows of Schema in use (`content-extensions.tsx` `renderInUseRow`) |

### (b) Sources are visually distinct; raw JSON is advanced

Before: the entry's own records were listed under "Additional schemas" after a
"How saving works" disclosure; defaults and shared output were hidden in a
collapsed "Defaults and shared output" list with Preset or Inherited badges
(`EntrySchemaManager` in `content-extensions.tsx`, before this change).

Now: "Schema in use" is the first section of `EntrySchemaManager`. One
row per record or emitted graph, ordered This entry, Content type default,
Shared, Site, each with a Kumo badge and a short scope (`ENTRY_SCHEMA_SOURCE_LABELS`
and `entrySchemaInUseRows` in `entry-schema-model.ts`; badge variants `SOURCE_BADGES`
in `content-extensions.tsx`).
The four badges differ in style, not only in text: This entry info, Content
type default secondary, Shared outline and Site filled neutral. Each badge
sits in a fixed slot before one actions group, so the badges form one
column whatever actions a row has.
Entry rows alone carry edit and remove; other rows link "Manage in Schema".
Resolved JSON-LD stays behind each row's eye toggle. Add schema and the
template picker follow the list with one saving helper line (`savingNote`). The
per-entry default switches and shared records that add nothing ("Shared schemas
not added here", with the reason) sit in one collapsed "Defaults for this entry"
(`entrySchemaNotAddedRows` in `entry-schema-model.ts`). With
schema output off, only the entry's own records are listed and an alert names
the switch. A default switch save refreshes the preview, list and graphs; until
they settle the panel keeps the read it showed (`switchSettling`), so the
disclosure stays open and the switch, busy through `aria-disabled` rather than
`disabled`, keeps keyboard focus. A failed read ends the hold and shows its
state.

Template-derived records cannot be told apart once saved: **open** (below).

### (c) Template application is visible and honest

Satisfied for semantics: applying a template creates an independent copy. Entry
picker text says the copy does not change when the template is edited or
deleted (`EntrySchemaTemplatePicker` in `entry-schema-library-controls.tsx`); the
workspace copy is disabled and unscoped until chosen (`schemaWorkspaceTemplateCopy`
in `schema-workspace-model.ts`).

Changed: Library is now a Schema tab (Schema map, Custom schemas, Library,
Defaults; the "Schema sections" tabs of `SchemaView`). `?view=library` stays a
deep link to that tab through the shared Schema owner (`SchemaContainer` in
`admin.tsx`; `schemaWorkspaceRoute` and `schemaWorkspaceSectionForRoute` in
`schema-workspace-model.ts`); the rail shows one Schema item
(`WorkspaceNavigation` in `workspace-shell.tsx`). Use template opens the builder
in place with `Independent copy of "<name>"` (`openTemplateCopy` in `SchemaView`) and moves
the URL to `view=schema`, so Back returns to Library, with focus as in
"Library reads, focus after Back and narrow forms" below. Row actions are
secondary; New template is the only primary (`SchemaLibraryView`).
The library intro states that a template is never added to a page by itself.

Where a template was applied, and to which content types or entries, is
**open** (below).

### (d) Adding a type that already exists warns without changing anything

Satisfied in the entry form: choosing an emitted type asks first, and guided or
advanced drafts with an emitted type show "may add another graph of the same
type; existing graphs are not replaced or merged" (`overlappingOutputTypes` and
`OVERLAP_DESCRIPTION` in `entry-schema-authoring-controls.tsx`).

Added for the workspace builder: each type in the list notes how many saved
custom schemas use it, and the composer shows "<type> is already in use" with
the matching saved custom schemas and enabled defaults (the `SchemaView` composer;
`seoSchemaComposerTypeUses` in `schema-composer-view-model.ts`). It is read-only context; saving still
adds a separate record.

### (e) Predicted output is never labelled as observed public HTML

Satisfied: the entry list reads "This preview covers this plugin's output only;
EmDash, your theme or other plugins can add JSON-LD. Check the public page source
for full output." The unsaved Preview is "The predicted JSON-LD from this plugin
for this entry if this form were saved now" (`EntrySchemaCandidatePreview`). The
Schema map says it "shows saved choices, not emitted markup" (`schema-map-view.tsx`),
and the workspace draft "does not inspect a public page" (the `SchemaView` composer).

### Library reads, focus after Back and narrow forms

`SchemaLibraryView` shows the error-only view only while nothing has been
loaded. A read that fails after the list was shown keeps the list, the form
with its draft and any not-confirmed notice, and adds an alert: "The schema
library could not be read again", or the administrator-access text for a
denied read. Its Try again shows that its read is running. Until a read
succeeds, Save, New template and each row's Use template, Edit and Delete
stay off, and an open delete review cannot confirm. The unconfirmed-save
lock from `schema-library-model.ts` is unchanged. A deletion refused because
the library changed says nothing was deleted (`DELETE_CONFLICT` in
`schema-library.ts`); a refused save keeps its own wording.

Use template records its template (`libraryReturn`). When Back shows the
list again and focus was lost to the page, focus goes to that template's Use
template button, or to the Schema library heading when that button is
missing or disabled. This also holds when the read sent on return removes or
turns off that button after the cached list showed it. Focus the person moved,
such as onto the Library tab, stays where it is, and a fresh page load of
`?view=library` moves no focus; later in the same admin session, a Library
open that loses focus returns it to the last Use template button or the
heading.

Close, Escape, Discard and a successful save focus New template. When a read
settles a not-confirmed save and closes the form, focus goes to New template
only if it had left the page; focus the person placed on another control
stays. When the Library control that last held focus (`lastFocus`, recorded
by the section's `onFocus`, so dialog controls count) is removed, disabled or
hidden, focus goes to the Schema library heading once no read or request is
running and the store holds what the view rendered, also after a retry that
fails again. Examples are Try again while its read runs, the Save not
confirmed alert after a read settles it and keeps the form, and a conflict
choice once it is made. That move never takes focus from a control that can
hold it (`canHoldFocus`). The error-only view has no heading, so there focus
stays where the browser leaves it until a read succeeds.

Type cards keep their title, description and optional saved-output notice in
the flexible text column beside the icon. Card content stays aligned to the
top when a neighboring card needs an extra line.

The template form's type chooser and guided field grids use one column while
the authoring root (`.shipit-seo-entry-authoring`, a query container in
`admin.css`) is 480px wide or narrower. The entry dialog keeps its own 540px
panel breakpoint; 480px stays below 540px minus the widest dialog inset
around the form, so inside the dialog the root's query matches only where
the dialog rule already stacks the grids.

Inside the guided field grids, each field wrapper may shrink to its cell
(`min-width: 0`), and each guided Select trigger, input and textarea also
stops at the cell edge (`min-width: 0`, `max-width: 100%`, no set width).
Kumo wraps a variable source Select in a one-column grid whose auto track
takes the label's width, so that track is `minmax(0, 1fr)`; otherwise
`max-width` resolves against the track and the trigger still crosses the
cell. A control keeps Kumo's own width where it fits; a long selected label
such as "Resolved meta description" otherwise ends in an ellipsis from Kumo's
value span instead of crossing the form border. The Library form and the
entry dialog share these rules.

## Open gaps

- **Save as template from the entry form.** Needs a library write from the
  entry dialog with its own revision read, conflict and unknown-outcome
  recovery, separate from the Library tab's draft store. Not small or safe here.
- **Template provenance.** Saved entry and site records store no template
  identifier (`EntryCustomSchema` in `src/entry-schemas.ts`, `SchemaLibraryTemplate`
in `src/schema-library.ts`), so a saved copy
  cannot be badged as template-derived and the library cannot list where a
  template was applied. Needs a stored, inert `copiedFrom` field and a
  bounded usage read; a storage contract change.
- **Library loads with the Schema configuration.** The Library tab renders
  inside the Schema owner, so it waits for the schema configuration read and
  is unavailable when that read fails.

## Acceptance

Selfchecks cover the row model, sources and order, the not-added reasons, the
production row renderer (badges, actions, eye toggle, inline confirm), the
section order, the route helpers, rail and deep-link routing, the template
handoff and copy independence, the type search and keyboard model, the
type-use notice, the Library view's failed reads and focus after Back
(`schema-library-view.selfcheck.ts`) and the narrow template form grids
(`workspace-layout.selfcheck.ts`). Browser checks still needed: the S1, S2
and S3 checks in the design mapping, focus after Use template and after tab
changes, Back and Forward between Library and Schema, the type picker with a
screen reader, narrow editor and workspace widths including the Library
template form, and a failed Library read after a save whose result is unknown.
