# Score and checklist contract (analyzer 24)

The score is a checklist result, not a search-engine score or ranking
prediction. One engine and presentation model serve basic browser checks,
saved analysis, scans, Overview and the sandbox panel. Opening an entry runs
browser checks without a provider request, scan or history write.

The sandbox panel shares the editor's groups. The sandbox Content analyzer
page retains a category list; full parity for that page remains planned work.

## Calibration

[Google's SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide#things-we-believe-you-shouldnt-focus-on)
prescribes no minimum or maximum word count.
[Rank Math](https://rankmath.com/kb/score-100-in-tests/) gives no credit below
600 words only for its length test, not an overall score limit.
[Yoast skips density checks below 100 words](https://yoast.com/what-is-keyphrase-density-and-why-is-it-important/)
and [varies word-count guidance by content type](https://yoast.com/blog-post-word-count-seo/).
The Article profile's 600-word pass threshold and limit of 70 below it are
Shipit product calibration, not a Google mandate or an exact competitor rule.
They do not apply to the General content profile.

## Rules

1. **Row words.** Scored pass: **Passed**. Scored review: **Partly met**.
   Scored fail: **Failed**. Advice review: **Suggestion**. Advice pass:
   **Passed**. Unavailable: **Not checked**. Not applicable: no row. Earlier
   analyzer: **Earlier result**. Each policy lists its allowed outcomes, and
   the engine refuses others.
2. **Not applicable is structural:** conditional phrase checks without a
   focus keyword, no secondary keywords, no images, image alt checks off, no
   links, no section headings, a body format without links or headings, an opaque slug, no title or description
   to fit, `nosnippet`, an unpublished entry's indexing directive, the
   profile, no body text for keyword placement advice, a title without the
   focus keyword for phone visibility (the title row already fails), general
   content under 300 words without section headings for heading advice, no
   body images for alt checks (image fields such as the featured image are
   not body images), or a readability sample below its minimum. Short text
   is otherwise scored by body text length. A known body under 100 words makes
   the keyword repetition ratio not applicable because its sample is too small.
3. **Words** are counted with `Intl.Segmenter` word segments when available,
   otherwise whitespace, over all extracted body text. Keywords in scripts
   written without spaces match as substrings. Browser and server use the same
   extractor. Unconfigured unsupported blocks can only add words: a short count
   with such blocks is **Not checked**, a passing lower-bound count stands.
   Explicit custom-block mappings select visible fields and block versions;
   an unknown version, malformed selected value or extraction limit withholds
   complete-body checks and the numeric badge. Browser and server apply the
   same mapping to the same saved snapshot. A mapped body field also works
   when its name is not `content`. Mapping identity participates in saved
   result freshness and input capture. Template text and transcluded entries
   are outside saved-body checks.
4. **Score** is `round(100 x earned / available)` over evaluated scored rows.
   Partly met earns 35%. Limits are derived from rows; the lowest applies and
   the active cap is named beside the score. Full calculations remain in the analysis result, not the editor summary:
   - missing title: 49;
   - article body under 50 words: 40; 50 to 599 words: 70;
   - no focus keyword configured: 79;
   - focus keyword repetition failed: 79;
   - focus keyword in none of title, description and body text: 79.
5. **Number** requires every weighted row to have been evaluated. Opening an
   entry runs basic browser checks and shows a number without enabling optional
   server analysis. A configured assessment profile takes priority; otherwise
   the built-in `posts` collection uses Article, and Pages and custom collections
   use General content. The header names the default checks, and Analysis
   options offers a profile override. This fallback never saves a profile,
   starts server analysis or derives its choice from schema output. Suggestions,
   not-applicable rows and an unset keyword never hide it. A weighted row that
   could not be checked shows a dash and **Partially checked**; so does a
   General entry whose body text length could not be checked, although that
   row carries no weight there. A General entry under 50 words shows a dash
   and **Too little text to score**. Every
   surface (editor, list, toast, overview, history, scan, sandbox) uses the
   same display decision; dashed results stay out of averages and trends.
6. **Bands** (Shipit guidance): 80+ **Good**, 50-79 **Needs improvement**,
   under 50 **Poor**. Status and grade follow the band of the limited score.
7. **Counts.** Issues are Failed or Partly met rows. A group pill reads
   `N issues[, M suggestions]`, else `M suggestions`, else `K not checked`,
   else **All good** when a row applies, else **Not applicable**. The header
   shows the sums of the group counts from one function. An overview entry
   needs attention when it has scored issues or a displayed score below
   **Good**.
8. **Rows.** Order: Failed, Partly met, Suggestion, Not checked, Passed;
   heavier first. Each row shows icon, label and status word on line 1, with
   the whole label at narrow widths. Only a Failed, Partly met or Suggestion
   row with a target shows one action at the row end, on line 1 or, at narrow
   widths, below the finding, and only when that target is available (**Add
   keyword**, **Edit title**, **Edit description**, **Review URL**, **Edit
   image**, **Open Advanced**). **Review URL** opens the saved URL review,
   since the slug is edited in the host. Detail,
   recommendation (also for Not checked), evidence and basis open on demand.
   Not-applicable rows collapse into one closed `N not applicable` list.
9. **Keywords are optional.** Without one, the score cannot reach **Good**:
   its maximum is 79, and lower limits still apply, including **Poor** results.
   An **Add keyword** action focuses the field. The summary says
   **Add a focus keyword**, or retains a lower limit with **No focus keyword**.
   The measured focus-keyword evidence must agree with the normalized saved target.
   Configured targets require evaluated title and description checks. Their
   body check is evaluated, or **Not checked** together with body length when
   the body is unread. Unset targets leave those three checks not applicable.
   With a target, the focus-keyword row is hidden; a missing primary phrase
   fails the title, description and body text rows. URL and placement checks
   are advice. Secondary keywords feed advice only.
10. **Repetition**: a known body under 100 words makes the ratio not applicable.
    At 100 words or more, occurrences divided by body words above 3.5% with at
    least 3 occurrences fails **Focus keyword repetition**. Feedback states the
    count and percentage, without diagnosing spam.
11. **Snippet fit** uses the preview's own metrics and widths from one shared
    module. Every state says "estimate", names the device and the cut point,
    measures the resolved text including what a Shipit template adds,
    excludes text the theme adds and never cites a character limit as a
    Google rule. A generated description asks for a written one. The
    publication date the preview shows before the description shares its
    lines in Description fit, the field estimate and the preview alike. A cut
    falls at the last whole word within 20 graphemes, otherwise where the
    text overflows. Evidence names fields in words, never storage keys.
12. **One source.** Header, checklist and scope note show the same result.
    When a profile is configured, they use current saved analysis matching the
    saved version and keywords, otherwise browser checks. With a default
    browser profile they use that browser result, so an older stored or session
    number cannot mask the current default checks. Browser module settings come from the entry preview. A
    stored result read on load is shown once one freshness read of its exact
    inputs confirms it, with no analysis or write; while analysis is admitted,
    a return to the tab confirms it again. Both sources name profiles alike
    (Article, General content).
13. **Accessibility.** The ring is `role="img"` named "SEO score N out of 100"
    or "No SEO score"; rows are list items; pills and statuses are text; dark
    pills use `[data-mode="dark"]`; no live region on the score.
14. **Versioning.** Analyzer 24 uses admin contract 48 and the current
    comparison policy. Analyzer 23 and earlier results stay
    readable in history but never render as a current number, band or meter
    and never enter current comparisons. They read **Earlier analyzer. Analyze
    again.** A scan resumed
    across the upgrade pauses for a policy change. Updating does not reanalyze
    entries or activate optional analysis or providers.

## Checks

When every weighted row applies, available points total 89 for Article and
79 for General content. Outcomes: P pass, R review, F fail.

| Group | Check | Weight, outcomes | Rule |
| --- | --- | --- | --- |
| Basic SEO | Title | 14, P/F | Resolved title present |
| Basic SEO | Description | 14, P/F | Resolved description present |
| Basic SEO | Public URL | 8, P/F | Valid public http(s) URL |
| Basic SEO | Body text length | article 10, P/R/F; general advice | Article: 600+ P, 300-599 R, under 300 F. General: Suggestion under 100 |
| Basic SEO | Focus keyword | advice | Suggestion when unset |
| Basic SEO | Keyword in title, description, body text | 4, 3, 3, P/F | Literal primary phrase |
| Basic SEO | Keyword in URL, introduction, subheading | advice | URL wording notes redirects |
| Basic SEO | Secondary keywords | advice | Each appears somewhere |
| Additional | Social image | 8, P/R | Image set; site fallback only adds a Suggestion |
| Additional | Image alt text | 6, P/F | Every body image has alt |
| Additional | Internal links | 5, article P/F, general P/R | Excludes fragment-only and self links |
| Additional | Link text | 3, P/R | No generic labels |
| Additional | Focus keyword repetition | 4, P/F | Rule 10 |
| Additional | Featured image, schema, canonical, empty alt | advice | Empty alt covers body images only |
| Search snippet | Title fit, description fit, keyword visible on phones | advice | Rule 11 |
| Content readability | Sentence length | 4, P/R | Average 25 words or fewer; n/a under 60 words or 3 sentences |
| Content readability | Paragraph length | 3, P/R | Longest 120 words or fewer; n/a without paragraphs |
| Content readability | Heading structure | advice | n/a for general content under 300 words without section headings |

Readability limits are Shipit guidance written for English. The indexing
directive is not a row: an excluded entry shows the existing banner.

## Regression cases

These cases assume a published entry, matching canonical, a sharing image,
no body images unless stated, and saved Portable Text.

| Case | Expected |
| --- | --- |
| Article, 2 words, metadata complete | 40 **Poor**, limit named, Body text length Failed |
| Article, empty body array | 40 **Poor**, no keyword placement advice |
| Article, 49 then 50 words with one link | 40 then at most 70 |
| Article, 61 words, 3 sentences, no links, no keyword | At most 70 **Needs improvement**, Body text length Failed |
| Article, 350 words, otherwise passing | At most 70 **Needs improvement**, Body text length Partly met |
| Article, 600 words, keyword placed, link, alt, schema, fitting snippet | 100 **Good**, groups **All good** |
| The same article with a featured image saved with empty alt | 100 **Good**, groups **All good** |
| General, 2 words | Dash, **Too little text to score** |
| General, 61 words, no links | Number shown, Internal links Partly met, short-text Suggestion, Heading structure not applicable |
| Keyword never used, 600 words | 79 at most, three keyword rows Failed, phone visibility not applicable |
| Known body under 100 words, phrase used 3 times | Repetition not applicable; no spam claim |
| Known body of 100+ words, phrase above 3.5% with 3+ uses | Repetition Failed; factual count and percentage |
| 3-word phrase 4 times in 300 words | Repetition Passed |
| Either profile, no keyword | Below **Good**, maximum 79; lower limits still apply. **Add a focus keyword**; **Add keyword** focuses the field |
| Unconfigured Posts, 63 words, server analysis off | Automatic Article number at most 70; default named; optional profile choice; no writes or scan |
| Unconfigured Pages or custom collection, 63 words | Automatic General number when evidence is complete; schema does not affect the choice |
| Configured profile | Saved selection overrides the browser default |
| Japanese 3000-character body | Word count from segments; not limited |
| Custom blocks with a short paragraph | Body text length Not checked; dash |
| Template body field | Dash, **Partially checked**; excluded from averages |
| Too long for phones | Suggestion naming phones and the cut point, marked estimate |
| Production browser checks | Same rows and policy as the server for a default body; `Intl.Segmenter` word boundaries can vary between browser and server ICU versions |
| Production browser checks, custom blocks with a short paragraph and no images | Same rows as the server; Image alt text not applicable, Body text length Not checked |
| Group counts | Header equals the sum of group issues, suggestions, not checked |
| Analyzer 23 or earlier stored result | **Earlier analyzer**, history kept, no current number or comparison |
| Sandbox panel | Same groups, pills and band as the editor |

The editor summary contains no weight table or partial point totals. A short
scope note explains an incomplete score without suggesting that enabling
automatic analysis or selecting a profile can make unsupported body blocks
readable. The optional saved-analysis action belongs to Analysis options.

## Maintainer checks

Keep engine results, browser results and all displayed bands, counts and scope
notes consistent for the same saved inputs. Exercise unavailable inputs,
profile changes, earlier results, stale saved results and optional analysis
off. Check keyboard use, light and dark themes and narrow widths.

Owners are `analysis.ts`, `check-presentation.ts`, `score-lifecycle.ts`,
`snippet-fit.ts` and `admin-ui/editor-basic-analysis.ts` under
`packages/emdash-plugin-seo/src/`. See [editor layout](editor-layout-contract.md)
and [current platform coverage](compatibility.md).
