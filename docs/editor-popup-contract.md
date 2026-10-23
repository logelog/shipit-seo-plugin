# Editor popup authoring

Edit SEO has General, Social and Schema tabs. General edits the saved native
SEO title and description; Social edits the native sharing image and the
plugin's separate social text. Schema owns its own records as described in
the [schema contract](schema-authoring-contract.md).

Native metadata saves and plugin Social saves are separate operations. Their
controls must name the fields they save and must not imply an atomic save of
both stores.

## Native save boundary

The editor uses published native APIs and the exported media picker. It does
not patch the host, access a private editor store, bridge through the DOM or
create parallel General overrides.

Native SEO writes send only changed fields, with the observed revision and
locale. They preserve canonical, noindex, content and unrelated metadata.
The host has no shared auxiliary-save controller for extensions, so the
popup cannot claim that a dirty parent draft has been synchronized.

EmDash stores these fields outside content drafts. The save note explains
that changing a published entry's SEO fields affects the live page
immediately, even when other content changes are still a draft. An
unpublished entry uses the fields when it is published.

Clearing a custom sharing image reveals the featured image or configured
fallback. It does not delete the media asset or suppress every sharing image.
An unsaved image preview is labelled Unsaved sharing image; the image status
line explains which image will be used after saving.

## Readback and recovery

A successful write is confirmed by readback. Timeout, conflict and uncertain
acknowledgement keep the draft and attempted values. Nothing silently reloads
the entry, discards a parent draft or retries a write.

| Readback or error | Required behavior |
| --- | --- |
| Attempt's original revision and original values | End the interrupted attempt, retain the draft and restore Save SEO fields and Discard SEO edits. A later attempt uses the same guard, preventing two writes from winning. |
| Original revision with unexpected values | Keep the outcome uncertain. |
| New saved values equal the attempted values | Confirm the save. |
| Other changed saved values | Open the changed-values review. |
| Definite host refusal (400, 401, 403 or 404) | End the attempt, keep the draft and explain that the changes could not be saved. |
| `ENTRY_LOCKED` conflict | Keep the draft and ask the editor to take over in EmDash. Do not open the revision review. |

Keep my edits and Use saved values adopt a reviewed saved revision. Retained
edits save through a fresh guarded write against that revision. Images in the
review are described as same, different or none, never by media path.

After adoption, the host entry and preview refresh once per saved revision.
Fields stay read-only until preview ownership facts match the adopted values.
A host entry already at or beyond that revision is not refreshed again.
A refresh that obtains a newer entry leaves the next preview read to that
entry.

## Preview states

The search card shows reviewed saved title and description while a revision
review is open, including fields the editor did not change. The sharing card
keeps its last loaded preview. After the review, draft substitutions are
allowed only when the preview's ownership facts are current for the locale
and no earlier SEO record owns the value. A cleared value uses the reported
fallback, or remains unavailable when no fallback was reported.

A reopened entry may be cached by EmDash. When the saved-content read finds
a newer revision, the panel refreshes the host entry once and shows Updating
preview until it arrives. Each explicit Retry preview or Retry checks sends
one request; it does not create a background retry loop. Loading inputs show
Loading checks rather than a failure or an instruction to reload.

The popup keeps character counts, accessible metadata, draft status and
loading or error feedback visible. The score and checklist use the shared
[score contract](score-checklist-contract.md); calculation details do not
belong in the everyday editor summary.

Owner: `content-extensions.tsx` and the `native-seo-editor-*` modules under
`packages/emdash-plugin-seo/src/admin-ui/`.

## Drafts and permissions

Unsaved popup edits survive navigation inside the admin in tab memory, keyed
by principal, collection, entry and locale. They are never persisted as a
draft record. Returning restores the values and reports that edits were kept;
opening Edit SEO reads saved values before allowing a save, with a review if
they changed. Closing or reloading the tab with edits uses the browser's leave
prompt.

Plugin preview, directives, keywords and schema routes require administrator
access through the host's plugin permission default, `plugins:manage`.
Native SEO fields use the signed-in account's content permissions. Refusal
must preserve edits without revealing another collection's data.

Opening or editing the popup starts no provider request, continuous scan or
analysis-history write.

## Maintainer checks

Exercise title and description set, clear and reopen; image selection,
replacement, removal and inheritance; entry and locale changes; denied writes;
stale revisions; and lost acknowledgements followed by readback. Check both
conflict choices followed by another edit and save, leaving and returning with
a draft, native-panel refresh and a dirty parent content draft. Verify the
resulting public metadata and preservation of unrelated fields and assets.

Cover light, dark, narrow and keyboard use. These are acceptance requirements,
not a claim that every native lifecycle and locale flow is qualified; current
platform coverage is listed in [compatibility](compatibility.md).
