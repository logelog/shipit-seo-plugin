# Check content and keywords

**Available in 0.4.0-beta.57 (unreleased).** The beta.57 scoring and custom-block
changes described here are not part of the published beta.56 package.

## Check a saved entry

Open a saved entry to run its basic browser checks automatically and see its
search preview. Optional server analysis can remain off. Opening the entry
does not start a bulk scan, contact a provider or write a saved score or history.

Checks read the last-saved body and the keywords currently in the panel. Save
body edits before expecting them in the checks. Keyword changes save after a
short pause; confirm the save status before leaving. If a keyword save fails,
use **Retry**. The checks do not inspect the rendered page.

Posts default to **Article** checks. Pages and custom content types default to
**General content**. A saved assessment profile overrides that default; change
it in **Analysis options**. Schema choices do not select the assessment profile.

## Read the score

The number is a checklist result, not a ranking prediction. A missing focus
keyword limits an otherwise available score to 79. The summary says **Add a
focus keyword**, or retains a lower limit with **No focus keyword**. Adding a
keyword enables phrase checks; it does not guarantee a higher score.

Lower limits still apply:

| Finding | Maximum score |
| --- | --- |
| No focus keyword | 79 |
| No resolved title | 49 |
| Article body under 50 words | 40 |
| Article body of 50-599 words | 70 |

The lowest applicable limit wins. Article word targets are editorial guidelines,
not search-engine requirements, and do not apply to General content. A known
General body under 50 words shows a dash and **Too little text to score**.

The checklist sets no minimum number of body images. With no body images,
the alt check is not applicable. When image alt checks are enabled, a body
image missing its alt attribute fails; explicit empty alt can suit a decorative
image and prompts a purpose review. A social fallback image does not count as
a body image.

## Check what the body reader can see

Standard Portable Text and Tiptap bodies are read directly. A site developer
must explicitly map custom blocks to the saved fields their templates display,
including the block version and the visible prose, headings, links and images.
See the [custom-block configuration](../packages/emdash-plugin-seo/README.md#custom-content-blocks).
Keep mappings aligned with template and block-version changes.

A body made entirely of unmapped custom blocks cannot supply a numeric score.
In a mixed body, unsupported blocks can leave body checks **Not checked** and
the score **Partially checked**. A passing word count from readable blocks can
remain a valid lower bound. Within an explicit mapping, an unknown block
version, unread selected field or extraction limit withholds the number.
Template-generated text, shared navigation and transcluded entries are outside
these saved-body checks.

Use the **Not checked** details to identify unread fields. Review what the
template displays and correct the field declarations before checking again.

## Save or refresh a result deliberately

Basic browser checks do not replace stored analysis. To store one entry's
assessment, save its profile, then choose **Analysis options > Saved analysis &
history > Save analysis**. With automatic server analysis paused, this updates
the current result without adding history. Optional automatic server analysis,
history and bulk scans have separate activation and resource controls.

An upgrade keeps earlier results and history. Older analyzer results show
**Earlier analyzer. Analyze again.** Opening the entry runs current basic
checks; use **Save analysis** or a deliberately selected bulk run to refresh
stored results. See the [upgrade guide](../packages/emdash-plugin-seo/UPGRADE.md#scores-and-earlier-evaluation-builds).
