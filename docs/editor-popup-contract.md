# Editor popup authoring

## Scope

Keep the existing General, Social and Schema popup and make its controls useful
for everyday editing. The accepted checklist-count source and exact installed
archive remain the baseline until this change has its own verification.

- General edits the native saved SEO title and description.
- Social can choose, replace or clear the native custom OG image. Clearing an
  override reveals the featured image or configured fallback; it never deletes
  a media asset or means suppressing all images. While an image change is
  unsaved, the preview caption reads "Unsaved sharing image."; only the image
  field's status line says what sharing uses after saving.
- Social text retains its existing separate explicit-save and conflict contract.
- Preview guidance must be brief. Remove the persistent About this preview
  disclosure and developer-oriented explanations while retaining accessible full
  metadata, useful character counts, loading/error feedback and draft status.
- The sidebar score header uses a number only when the shared assessment admits
  it. Otherwise show a dash and one short, accurate status. Keep checklist issues,
  advice, missing evidence and weighted calculations unchanged.

## Native save boundary

Use only the published native 1.3 APIs and exported media picker. No host patch,
private editor store, DOM bridge, parallel General overrides or revived legacy
SEO records are allowed.

Native saved SEO edits are independent guarded writes: send only changed native
fields with the observed revision and locale. Retain canonical/noindex and other
fields. The host exposes no shared auxiliary-save controller to the extension.
Do not claim a dirty host draft has been synchronized. Never silently reload,
discard a parent draft, retry a stale write or adopt an unknown acknowledgement.

Confirm successful writes through readback. Keep draft edits and attempted
values on timeout/conflict, offer a deliberate review path and use fresh guarded
writes for recovery. Native metadata and plugin Social text are not one atomic
save; controls must identify their actual save scope.

- **Interrupted save.** A check that reads the attempt's own revision with the
  pre-save values shows the write did not land: the attempt ends, the draft
  stays, and Save SEO fields and Discard SEO edits return. A new attempt
  carries the same guard, so if the original request commits later the host
  refuses whichever write arrives second. The same revision with other values
  stays uncertain. Changed values equal to the attempt are confirmed; other
  changes open the review. Nothing retries on its own.
- **Adopted reads.** Keep my edits, Use saved values and a check that adopts
  newer saved values refresh the host entry and the preview once per saved
  revision. Until the preview's ownership facts describe the adopted values,
  every native field is read-only and reads "Updating the preview to the saved
  values..."; the card says Updating preview.... While a review is open the
  fields are read-only and read "Choose Keep my edits or Use saved values to
  edit again."; the search card shows the reviewed saved title and
  description as Saved values, since the choice, not a preview read, is
  pending, and fields the user did not edit show the same reviewed saved
  values. The review takes precedence over drafts, so an edited field's card
  text is the reviewed value too. The card changes a field only while the
  preview's ownership facts are current, for the same locale, and report that
  no earlier SEO record holds a value for it; otherwise it keeps the reported
  text. A cleared reviewed value shows the reported fallback, or unavailable
  without one (`buildNativeSeoSearchPreview` in
  `native-seo-editor-preview.ts`). The sharing card keeps the last loaded
  preview during the review. A kept edit then saves as a fresh guarded write
  on the reviewed revision. The note adds "Your edits are kept." only while
  edits remain, and after a confirmed save it starts with "SEO values saved
  and checked.". A host entry already at or past the adopted
  revision is not refreshed again, and a refresh that brings a newer host
  entry leaves the preview read to that entry. The preview's own read of the
  saved entry before and after its request is part of the preview, not a
  further host refresh.
- **Reopened entry.** EmDash can show a cached entry when it is reopened. When
  the preview's saved-content read reports a newer saved version, the panel
  refreshes the host entry once for that version and shows Updating preview...
  from the first frame until the new entry arrives, never the failure alert.
  The preview read is not retried on its own: the first read and each Retry
  preview or Retry checks send one request, the host entry read while the
  saved entry is newer, otherwise the preview read. While the checks' inputs
  are still being read, including a cached preview read again on return, the
  header reads Loading checks... and the checks area "Loading the saved
  content and settings..."; the reload instruction appears only after a read
  ends unusable.
- **Save scope copy.** EmDash stores SEO fields beside the entry, outside its
  drafts. The note by Save SEO fields says that a published entry's live page
  changes at once, even while other changes are a draft, and that an
  unpublished entry shows the fields once it is published.
- **Leaving the entry.** Unsaved popup edits are kept in memory for the tab
  when the panel unmounts inside the admin, keyed by principal, collection,
  entry and locale, never written. Returning restores them over the saved
  values they were made against with a note in the sidebar and dialog; opening
  Edit SEO reads the saved values once before they can be saved, and opens the
  review when those changed. Reloading or closing the tab with unsaved edits
  asks first through the browser's leave prompt.
- **Review wording.** The conflict review names images in words (same,
  different or none), never by media path.
- **Refused writes and denied collection.** The panel's own plugin routes
  (preview, directives, keywords, schema) need administrator access: a route
  that declares no permission defaults to EmDash's `plugins:manage`. The
  popup reads and writes the native SEO fields through EmDash's content API
  under the signed-in account's content permissions. "Denied collection" in
  the acceptance list means an entry write the host refuses for that account
  (400, 401, 403 or 404): the attempt ends with no write, the draft is kept and the
  notice says the changes could not be saved. A 409 with code `ENTRY_LOCKED`,
  another editor holding the entry, is its own outcome: nothing was written,
  the draft is kept and the notice asks to take over in EmDash before saving.
  It never opens the changed-values review, which only a revision conflict
  opens (`classifyNativeSeoWriteError`).

## Acceptance

Verify unavailable, limited and fully qualified score states; concise checklist
counts; absent visual developer disclosures with full metadata still accessible;
light/dark, keyboard and narrow layouts; unsaved preview and explicit save/close.

For native authoring, exercise title/description set/clear/reopen, image
choose/replace/clear/inheritance, denied collection, locale/entry switch, stale
revision, lost acknowledgement followed by an unchanged check, the search card
during each review, each conflict choice followed by an edit and save, leaving
and returning with a dirty draft,
native-panel refresh and dirty parent content followed by autosave/manual Save. No content, canonical, noindex, unrelated
metadata or media asset may be overwritten. Check resulting published metadata.
Locale switching and the denied-collection case have no installed result;
the `0.4.0-beta.48` customer documents state that locale switching is not
verified.

No provider request, continuous scan, history write, new hosting service or
translation expansion is introduced by opening or editing the popup. Complete
focused checks and native verification before packaging. Recheck the exact new
archive in the retained consumer fixture before promoting the verified source.
