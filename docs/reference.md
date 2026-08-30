# Reference

Deep reference material moved out of the README so the front page stays a
landing page.

---

## Reading the document

Three tools answer "what is in there" without judging anything.

**`indesign_status`** takes no parameters. It reports the InDesign version, every
open document with its `saved`/`modified` flags and full path, which one is
ACTIVE, and any open books. Worth calling first in almost every session: every
other tool works on the active document, and with several files open that is not
always the one you have in mind.

**`doc_overview`** — structure of the active document: pages, stories with their
length and an overset flag, paragraph and character styles, fonts, links. Two
parameters. `sections` selects which blocks come back; a section not named is
absent ENTIRELY. `maxStories` (default 60) caps the story listing — the default
comes from measurement, not taste: a row weighs ≈131 B, so 60 rows ≈8 KB, while
the full response on a 196-page book weighed 122,582 B and would not fit back
through the client. The `totals` block is ALWAYS present and is counted BEFORE
any truncation, so its numbers stay complete even when the listing is cut, and a
cut always announces itself as `storiesTruncated { shown, total, rule }` — a
silent cut would read as "these are all the stories".

**`story_read`** returns the text of text containers together with character
offsets, a page breakdown and an overset flag. `containerIds` restricts the
listing (`["story:0", "story:3/footnote:1"]`); without it, everything. A
"container" is a story, a table cell or a footnote — cells and footnotes are
separate containers because their text is not part of `story.characters`, so a
tool that walked stories alone would silently miss them.

## Audit families not covered elsewhere

**`typography_audit`** — spacing, dashes, quotes, apostrophes, and the 2019
Ukrainian orthography. `locale` picks the rule pack (`uk`, `en-US`, `en-GB`);
`ruleIds` narrows to named rules; `sampleSize` caps samples per group. Findings
carry a `confidence`: `high` is what `typography_apply` writes without review,
`needs-review` never is. Two blocks are inventory rather than verdict —
`spelling2019` reports only pairs where BOTH forms occur (a consistent edition
cannot be faulted for choosing one), and `piv2019` issues a verdict only where
the orthography itself does, listing everything else without one.

**`bibliography_audit`** — ДСТУ ГОСТ 7.1 / ДСТУ 8302 / Chicago conformance for
a bibliography. `standard` selects which, and it selects the SEGMENTER too, not
just the rules: a ДСТУ record opens on a numbered paragraph, a Chicago entry is
unnumbered, so the wrong standard yields zero records rather than wrong ones.
`recordPattern` and `recordDiscriminator` say how records are recognised in the
text — both have per-standard defaults. `layers` restricts which layers run;
its member is now `"standard"` (the chosen standard's own family), with `"dstu"`
kept as a deprecated alias so older calls keep working. Under Chicago, a
paragraph carrying Cyrillic is skipped with `reason: "cyrillic"`, so an inert
run says so instead of looking clean. Reports numbering gaps, unparsed records, uniformity
across the list, and non-breaking-space findings. Because fixing `bib-nbsp-*`
reflows text, the response ends with a `nextStep` pointing at
`composition_audit` — the fix and its consequence are one workflow, not two.

**`bibliography_apply`** — writes the confirmed rules as one undo step, after
backing the document up into `_backups/`. Like `typography_apply` it confirms BY
RULE rather than by match, and that is why `expectedRecords` is mandatory: rule-
level confirmation is only safe while the record set is the one you reviewed,
and the Chicago segmenter can open an entry inside prose that carries a year. A
count mismatch refuses the write outright. `standard` must match the audit, and
a rule id from another standard's family is refused by name rather than
silently dropped. The nbsp layer is not applied here — those findings need the
noBreak answers only the audit path collects.

**`spelling_audit`** — runs the text against InDesign's own Hunspell
dictionaries. `family` selects `language` (ranges whose language tag is wrong)
or `words` (unknown words); `languageDictionaries` overrides the mapping;
`maxResponseBytes` bounds the reply. Two limits are stated in every response
rather than left implicit: the dictionary takes precedence over the 2019
orthography, so a correctly typed «проєкт» still comes back `word-unknown`; and
"absent from the dictionary" is not itself an error — proper names, neologisms
and borrowings are legitimately absent.

**`geometry_audit`** — frames, bleed, anchored objects, image resolution, text
wrap. `families` selects which; `nearMissThresholdPt`, `minPpi` and `anchorRule`
have NO defaults on purpose, because 300 ppi for offset and 150 for digital is
the printer's decision and the anchor rule is a property of the publication.
Every response carries `notMeasured` and `caveats`, and they are the point of the
tool as much as the findings: master-page elements are invisible to the
`page.allPageItems` walk (measured — 50 folios gave zero), a rotated frame's
`geometricBounds` is an axis-aligned envelope rather than its sides, and a vector
image has no ppi by construction.

**`color_audit`** — ink coverage, rich black under small text, overprint, palette
consistency. `maxTotalInk` (300), `richBlackMaxPointSize` (24) and `expectedInks`
(4) are parameters, not measurements: the document knows nothing about the paper
or the print shop. `includeNonPrinting` and `includeHidden` default to `false`.
The response names what it could NOT see, which matters more here than
elsewhere: InDesign refuses to report overprint at zero ink coverage, and ink
inside a placed graphic is not visible at all — the script sees the link's colour
space, not the ink in a pixel, so a 400 % black inside a placed file is not found
by this tool.

**`page_render`** — a raster of one page or spread, returned as an image
alongside the numbers. `page` or `spread` selects the target; `maxPx` and `dpi`
are mutually exclusive (default 1400 px on the long side); `bleed` includes the
bleed area. Use it to LOOK at a page, never to judge ink: a rich black and a
100 % K black are indistinguishable in a raster, and overprint is invisible in
one by definition. Those are questions for `color_audit`, which reads the file
rather than a picture of it.

## How corrections are applied

**`pdf_read_annotations`** — reads a proofreader's markup out of an annotated
PDF: the comment text, the page, and the text the annotation sits on, so the
result can be fed straight into `corrections_plan`. It takes an absolute path;
the file is read where it lies and is neither copied nor uploaded anywhere,
because only the original path guarantees that the annotations belong to the
edition the layout actually links to.

1. Corrections arrive as an annotated PDF, a "was → became" list, or dictation in chat.
2. `corrections_plan` shows exactly what will change: page, context, status, warnings. The document is not modified.
3. You confirm the positions you want.
4. `corrections_apply` saves a copy to `_backups/`, applies everything as one undo step, and re-checks the text before every write.

**The `new` field goes through the typography rules (B4).** What you write into `new` is not necessarily what
ends up in the document verbatim: before writing, it is normalized *in the context of the seam* —
together with the document's neighboring text on both sides of the edit point. A hyphen between words
(`«мама - це все»`) becomes an em dash (`«мама — це все»`), straight quotes become typographic ones, a double
space at the junction of the edit and the existing text collapses to one. Normalization is computed EXACTLY
once, during the dry run of `corrections_plan`, and is stored together with the candidate —
so what the plan shows and what goes into the document during `corrections_apply` are guaranteed
to match. Every normalization is visible by name: both in the plan's candidates and in the
`normalizations` field of the `corrections_apply` report. If nothing needed normalizing, the field is empty —
`new` went in verbatim.

Document copies are kept in `_backups/` next to the file. `corrections_apply` keeps up to 10
of its own most recent copies and automatically deletes older ones — for details on which files this
touches, and which it never touches, see the "Safety model" section below.
Plans are stored in `~/.indesign-mcp/plans/` (overridable via `INDESIGN_MCP_HOME`).

## Composition audit and fix

`composition_audit` measures the document's composition (tight and loose lines, widows and orphans,
short last lines, hyphenation ladders, a hyphenated word split across a spread, rivers, dashes, a word
separated from a line break) and returns a breakdown
with a suggested fix for every finding — without changing anything. Natural space width is
calibrated **from the document itself**, from the last lines of paragraphs in the measured range, rather than
from a font-metrics table or a made-up constant. So calibration can fail for a
particular style (too few samples, only single-line paragraphs, justification applied to every line including
the last) — such styles go into a separate "not measured" list in the report, rather than being silently mixed with
"clean." The tool doesn't invent a density threshold either: by default (`spacingMode: "survey"`)
it shows the distribution of ratios and flags nothing — you name the threshold yourself, after looking at the
distribution in a real chapter of your own document.

**A dash at the start of a line.** When the compositor wraps a mid-sentence dash to a new
line, it reads as a paragraph indent or a fake line of dialogue. The tool proposes
replacing the space before it with a non-breaking one. The exception is a dash that genuinely starts a paragraph,
a list item, a line of dialogue, or a sentence — there it belongs. A non-breaking space doesn't
pull the dash up; it makes the "word + dash" pair unbreakable, so the word can drop
down together with the dash — a re-measurement shows this as `displaced`.

`composition_apply` writes the selected suggestions as one undo step. But a fix
(paragraph tracking, a soft hyphen before a word, a non-breaking space before a dash) changes how
InDesign's own line-breaking engine recomposes the paragraph — so a defect may not disappear
but move to the neighboring line
or give way to a new one. That's exactly why the report carries a `verification` field: after writing, the affected
pages are measured AGAIN, and each finding is reported as `resolved` (gone), `still-present`
(remains), or `displaced` (a new defect appeared nearby that wasn't there before the write) — "applied
N" without this re-measurement says nothing about whether things actually got better.

## Document map

`document_map` reads the document's structure (or a `pages` range): each page's spread side and applied
parent page, spread composition, chained frames (`previousFrameId`/
`nextFrameId`) and overset, plus an inventory of paragraph styles — how many paragraphs, on which pages,
what sizes. It changes nothing.

**There is no heading tree without an explicit `headingStyles`.** InDesign has no concept of "heading
level" — the tool fundamentally will not derive one from a style's name or size, because that would be
guessing, which breaks on the very first document with a different naming convention. Pass
`headingStyles` — an array of paragraph style names in level order, with the first element as the highest
level; position in the array determines the level, not the style name. Without this parameter, the `headings`
field equals `null` (not an empty array — `null` means "wasn't asked," not "looked and didn't
find"), and instead of a tree you get `styleInventory`, from which you name yourself which styles are
headings.

## Layout systematicity audit

`layout_audit` shows two different things, and they are NOT mixed into a single finding:

- **`overrides`** — paragraphs that deviate from their OWN declared paragraph style (a different
  indent, size, justification, font, tracking, or a manual list marker instead of a real one);
- **`masters`** — pages detached from their own parent page: an item overridden, removed
  (separately — if the missing item carried the page's autonumber, that's `folio-missing`, a more serious
  defect than the general `master-item-missing`), or a page with no parent page at all.

There's no threshold here, and none is needed: the reference is declared by the document itself (the paragraph style — for `overrides`,
the parent page itself — for `masters`), so a discrepancy is a fact, not a judgment tied to an arbitrary
number.

**A per-style summary by default, a per-item listing only on request.** In a document that has
not been run through composition proofreading, overrides can number in the thousands: a flat list of paragraphs would be
just as unusable as a list with a made-up threshold. So without a `detail` parameter the tool
returns `styles` — one entry per style, with how many paragraphs use that style, how many of them
deviate in each property group, and which values occur — rather than a raw list of paragraphs.
"Not compared" is a separate list, `notCompared`, not mixed in with findings: "not checked" is
not "deviates." There are exactly three reasons: `unavailable` (the declared value is unavailable),
`mixed` (a declared value exists but the actual value is mixed within the paragraph), and `character-style` (the group was
muted by an applied character style — which legitimately changes the font, size, and tracking). The third reason is
required precisely because a muted group would otherwise vanish without a trace, and an empty style report
would read as "no deviations," even though half the groups were never checked at all. A named list of
individual paragraphs for ONE (style, group) pair — via `detail: { styleId, group }`, where `styleId` is the same
field that tags every `styles` row; NOT the style name, because two different styles can be named
the same (measured by probe H5), and filtering by name would return findings from both. Without a `detail` parameter
it equals `null` in the response, no matter how many findings there are.

**The value list in the summary has a ceiling — 20 distinct "property + value" pairs per group.**
`groups[].values` grew with every new pair, with no built-in bound, and without `pages` the whole
document is measured. When truncated, `valuesTruncated: { shown, total }` appears alongside it, and `total` is the
full count of distinct pairs FOR THAT SPECIFIC style and group, not a document-wide sum. Only the
list is truncated: `deviating`, `paragraphs`, and the `count` of already-shown pairs remain full, and their
addresses go into `detail`, which has its own ceiling. The ceiling is shared with `styles_audit` — both tools
summarize findings through one function (`summariseByStyle`).

`families` (both by default) selects which families to count; `includeMasters` (`false` by default) determines
whether to count paragraphs on the parent pages themselves — a running head deviates from its paragraph style
by construction, so by default such paragraphs are excluded from the audit. The tool writes nothing to the document
and proposes no fixes — unlike `composition_audit`, there is no matching `_apply` here.

## Paragraph style hygiene

`styles_audit` shows five different families, and none of them collapses into a single shared total:

- **`usage`** — declared but unused paragraph styles (few in number, in `findings`) plus paragraphs
  applied directly on top of a built-in style (`[Basic Paragraph]`, `[No Paragraph Style]`) — of which
  there can be any number, so they're reported only as a sum and through `detail`, not in `findings`;
- **`overrides`** — the same share of overrides as in `layout_audit`, but computed over the whole
  document and summarized to one row per style;
- **`scale`** — scaled text, grouped by the VALUE of the scale factor. This is NOT a defect: on
  a real working book, most such spots are a deliberate compositor's technique ("squeezed it to fit");
- **`character`** — local character-level formatting;
- **`hierarchy`** — `basedOn` inheritance: chain depth and pairs of styles indistinguishable across
  the measured set of properties.

**`style-unused` is NOT permission to delete a style.** It's the only finding in this phase that directly invites
a destructive action, and the boundary of measurement matters here: the traversal walks `story.paragraphs`
(`src/jsx/styles.jsx`) and does NOT SEE table cells or FOOTNOTES. A paragraph style — just like
a character style — used only inside a table or a footnote gets a firm "applied to no
paragraph," even though it's actually in use. So the warning lives in the text of the finding itself, not only in the
documentation: before deleting a style, check tables and footnotes manually. That same boundary undercounts
all numbers in the `character` family — an undercount, not a false statement.

The warning is deliberately split into two parts, and the reason is measured. The text of EVERY such
finding carries a prohibition with pointers ("don't delete without checking tables and
footnotes"), while the full explanation of the mechanism lives in the response ONCE, in the
`caveats.tablesAndFootnotes` field. The first draft repeated the full text in every finding, and measurement showed why that can't be done:
389 bytes per finding, 1,785 of 2,103 bytes of the total response-size increase on a fixture with five such
findings — 85% growth from one repeated sentence. On a book with 14 unused styles that's
about 5.5 KB, on a 100-style document about 39 KB — exactly the per-paragraph bloat that
the rest of this phase was written against. The `caveats` field is conditional: when there are no unused styles,
it doesn't appear, and costs nothing.

**A localized InDesign is the second named boundary.** Built-in styles (`[Basic Paragraph]`,
`[No Paragraph Style]`) and the sentinel `[None]` are matched by their ENGLISH names. InDesign
translates built-in style names along with the interface, so on a localized build the `usage`
family will silently return zeros — not "measured as zero" but "nothing recognized" — while
`[None]` will be counted among unused character styles. This was not measured: the working book was
run on an English build. The boundary is named, not "fixed" with a guessed translation list.

**Every row of `styles` carries TWO usage numbers, and they must not be confused.** `paragraphs` is how many
paragraphs apply the style AT ALL, including on parent spreads; `paragraphsAudited` is
how many of them actually went through the `overrides` check (parent-page paragraphs are excluded by construction —
a running head deviates from its paragraph style by design). The `ratio` fraction is
`deviating / paragraphsAudited`, NOT `/ paragraphs`. `ratio: null` covers THREE different states: the style
is used by no one; the style is used only on parent pages (`paragraphs` nonzero, `paragraphsAudited`
zero); the `overrides` family is disabled (`paragraphsAudited` zero on every row — the marker
for this third case specifically is `totals.overridePropertyDeviations === null`, not the zero itself).

**`character` is an inventory, not a list of defects.** A character style is meant to change size,
font, and tracking — that's its job, not a compositor's mistake. The `character` block gives only
a sum: how many DISTINCT ranges deviate from the paragraph reference (the same reference that
mutes the `sizes`/`font`/`tracking` groups in `layout_audit`) — `rangesDeviating` — plus a breakdown BY
PROPERTY in `byProperty` (the same spot can deviate in several properties at once,
so the `byProperty` sum is not equal to `rangesDeviating`, only never less than it), and how many
character styles are declared/used/unused. There's no named list of each individual range in
the main response: on the real book (198 pages) there are **744** such ranges (measured
by Task 10), and a list of that size would render the tool unusable — the exact same trap
Phase 4 already tripped over once, when 78 KB across three pages knocked the tool out. For the same reason
`scale` doesn't list scaled paragraphs
by name (only groups by value), and `usage` doesn't list paragraphs on the built-in style by name by
default.

**A real number, measured** (Task 10, `docs/measured-facts-phase5.md`, "Run of the finished
tool"): on the real working book (198 pages) the finished detector gave `rangesDeviating = 744` out of
`rangesAudited = 3480`. This is NOT the same number as the 449 in `docs/measured-facts-phase5.md` (Question 2),
measured by probe H5 on a NARROWER population — among 3137 BARE ranges, i.e. those with no
character style at all. The finished detector walks all 3480 ranges regardless of a character
style (because 131 of 164 scaled ranges sit specifically under a character style) and additionally
excludes parent spreads. These are two different populations; carrying a number from one into
the other would pass off someone else's measurement as your own.

**Three numbers in the `character` block, and only two of them divide into each other.** `rangesTotal` is all
measured ranges, parent pages included; `rangesAudited` is those that ACTUALLY entered the audit;
`rangesDeviating` is a subset of `rangesAudited`. The share is computed against `rangesAudited`: against
`rangesTotal` it's systematically understated. It's the same defect that in the `styles` rows is closed by
`paragraphsAudited`.

**`character` overlaps `overrides` too, not only `scale`.** `layout_audit`/`overrides`
mutes the `sizes`/`font`/`tracking` groups ONLY for a paragraph with an APPLIED character style. A paragraph
with BARE ranges is not caught by that muting — its groups are compared normally, and
`character` produces its own finding for that same range. So one spot in the document can produce a record
in both families at once, and their numbers can't be summed together, just as `character`
can't be summed with `scale`.

**The `scale` family is deliberately measured by TWO independent detectors.** `scale.paragraphs` comes from
directly reading the frame's scale (all paragraphs, parent pages included); `scale.ratioMatches`/
`scale.ratioUnavailable` come from a second, WEAKER detector (the ratio of font size to leading,
parent pages excluded), which is kept precisely because a trap in the primary detector once
spoiled a conclusion, and the independent second one didn't catch it. The gap between `paragraphs` and
`ratioMatches` has TWO causes at once: the second detector structurally misses part of the cases
(documented in `src/styles/scale.ts`) — and counts a DIFFERENT population of paragraphs
(without parent pages, whereas `paragraphs` includes them), because `ScaleMeasure` doesn't carry a
parent-page flag and can't be filtered the same way as `ratioMatches`. So the gap is a
SIGNAL, but part of that signal is now mechanical (different populations), not only methodological (different methods).
This is the ONLY one of the four per-paragraph/per-range families where the "parent pages out of scope"
policy (`paragraphsAudited`) is not carried through fully — not by decision, but because of a structural boundary of the measurement.

**Totals — per family, with no shared sum, and every number names its own unit.**
`totals` carries a fixed set of fields: `declaredStyles`/`usedStyles` (styles), `paragraphs`/
`paragraphsOffPage` (paragraphs — and `paragraphs` is NOT a denominator for anything: it counts all paragraphs of the measurement,
parent spreads and the pasteboard included, while the neighboring numbers
`usageDefaultStyleApplied`, `characterRangesDeviating`, and `ratioMatches` don't count parent pages;
you cannot divide one by the other, and there's deliberately no shared analogue of `paragraphsAudited` here — each
family has its own notion of "audited"), `usageUnusedStyles` (styles), `usageDefaultStyleApplied`
(paragraphs),
`overridePropertyDeviations` (pairs of "paragraph + PROPERTY" — NOT the same as the sum of `styles[].deviating`,
and NOT pairs of "paragraph + group": a paragraph deviating in both `leftIndent` and `rightIndent` — both belonging to
the `indents` group — counts as 2 here, not 1), `scaleParagraphs` (paragraphs), `characterRangesDeviating`
(DISTINCT ranges — not "range + property" pairs, see above), `hierarchyStylesInChains`
(styles more than one `basedOn` level deep — NOT a count of that family's findings). `character` and `scale`
describe the same spots from different angles (ranges vs. paragraphs) — a single "total findings"
number would be double-counting presented as fact, which is exactly why no such field exists at all. `null` means
"the family wasn't counted," not "counted and came out zero."

**A named list — for any of the four per-paragraph/per-range families, only via
`detail: { family, styleId, group? }`.** Addressed by the style's `.id`, not by name (two different styles
can share a name); `group` is required only for `family: "overrides"` — without it the request
is rejected by schema validation, not silently returning an empty list. `family` MUST be among the
requested `families`: if not, the tool explicitly refuses to answer, with an explanation — a silent
empty list in that case would mean the same thing as "the family wasn't counted," and the operator wouldn't be able to
tell the two states apart. Previously the named route existed only for `overrides` — a sum like
"so many character deviations" or "so many scaled RANGES" with no way to reach a
specific spot is unusable for taking action. (The 164 measured by probe H5 are specifically ranges; paragraphs with
`scale ≠ 100` were measured at 162, and the difference isn't a mistake: `horizontalScale` is a character-level property, so
one paragraph can contain several differently scaled ranges.) `detail` now works the same way for `scale` (paragraphs with a scale ≠ 100),
`character` (pairs of "range + property" — more detailed than the deduplicated `rangesDeviating` in the
summary), and `usage` (paragraphs directly on a built-in style — `styleId` here identifies the built-in
style itself). For `hierarchy` there is no separate addressing: both of its findings are already
few in number and already in `findings`. Without `detail`, no list is returned at all.

**The unit of a `detail` record is named IN THE RESPONSE ITSELF, via the `detailUnit` field** — not only in the
tool's description, which an operator might never reach. For `character` it matters most: `detail` there
addresses PAIRS of "range + property" (the same level of granularity as `overridePropertyDeviations`
for `overrides`), while `characterRangesDeviating` in the summary counts DISTINCT RANGES. This is not a bug but a
deliberate difference: the addressable list must show BOTH properties of a range that deviates in
two, otherwise the operator won't learn what exactly is wrong there.

**`detailTruncated.total` is never compared with the summary — in either direction.** These are numbers from different
DOMAINS: `total` counts records for ONE requested style (the list is filtered by
`detail.styleId`), while `characterRangesDeviating`, `scaleParagraphs`, and `overridePropertyDeviations`
count across the whole document. So `total` can be anything, and is most often SMALLER. The `detailTotalNote` field
in the response says this right where the operator reads the numbers themselves — next to `detailUnit`, which says WHAT
is being counted.

**The `usage` family has its own boundary, named honestly rather than hidden behind a new mechanism.** For
`overrides`/`scale`/`character`, addressing by `styleId` naturally splits the list: hundreds of spots
scattered across dozens of styles, and a ceiling of 50 rarely gets in the way of reaching what you need. For `usage` there is no such split:
`styleId` here IS the built-in style itself, and there are only two built-in styles
(`[Basic Paragraph]`, `[No Paragraph Style]`). A document imported from Word, where thousands of paragraphs
sit on one of these — exactly the book that motivated the ceiling in the first place — produces one indivisible pile:
`detail` shows the first 50, and the rest is simply unreachable through this tool. There's no pagination
(`offset`, `cursor`) in the project, and adding it for the sake of a single family was judged unnecessary — an honestly named boundary
beats a new mechanism tacked onto the end of the phase. Narrow the search for the rest via `document_map` or
`text_find`.

**`detail` has a ceiling too — not only the default response.** No more than 50 records
(the same threshold already established in the project for a list responding to one narrow request —
`MAX_CANDIDATES_PER_REQUEST` in `src/corrections/planner.ts`): this is exactly where the operator will go after
seeing a sum in the hundreds of ranges, and without a ceiling the 78 KB trap would land exactly where
the response itself points. The ceiling is applied in ONE line after the family is selected, not in each branch separately — that way it
doesn't depend on whether a particular family remembered the limit. When a list is truncated,
`detailTruncated: { shown, total }` appears — the same conditional pattern as `candidatesTruncated`
in the corrections planner: the field is present only when truncation actually happened; a silent truncation
would read as "that's everything there is."

**The default response has ceilings exactly where structures were growing without a built-in bound.** This phase already put
a ceiling on `detail`, but two constructions in the response itself remained unbounded by
anything: `styles[].groups[].values` grew with every new "property + value" pair, and
`scale.groups` grew with every new scale value, with the group key deliberately holding the EXACT
float value — meaning the construction maximizes the number of groups. The tool has no page parameter and always
walks the whole document, and the measured 9,187-byte default response is on a 9-page
fixture, and at the time of that measurement it said nothing about a 198-page book. Task 10 closed
that gap: on the real working book (198 pages) the default response (all 5 families, no `detail`) is
**48,411 bytes**, and with `detail` for the largest family — **69,743 bytes** (`docs/measured-facts-phase5.md`,
"Run of the finished tool"). Both structures are now truncated, and the truncation is
NAMED with the same conditional pattern as `detailTruncated`: `valuesTruncated`, `groupsTruncated`,
`containersTruncated`, `stylesTruncated` are present only when truncation actually happened. The
numbers themselves (how many paragraphs in a group, how many deviate) are not truncated — only the LIST is bounded,
not the accounting. Ceiling numbers are not measured and are named as ceilings with margin, not as a measurement. For the same
reason, `maxChainDepth`, which hit a ceiling on steps along `basedOn`, is now accompanied by
`chainDepthTruncated`: a silent ceiling used to show the same number for a chain 50 levels deep and one
500 levels deep.

There's no page-range parameter, and that is a deliberate decision, not an oversight: style hygiene is a
document-wide property, not a range property. A style unused on pages 10–20 might be used on
page 150, so an answer scoped to a range would be systematically wrong, not merely incomplete. The tool
writes nothing to the document and proposes no fixes.

## Numbering, running heads, and the table of contents

`pagination_audit` looks for text that **asserts something about a page** and is typed
by hand: running heads and numbers in the table of contents. Read-only, writes nothing.

**The most important point, and the one that's easy to misread.** A `folio-manual` /
`contents-manual` finding is **not a number error**. It says that the number was typed by
hand, so it won't update on the next recomposition, whereas its automatic neighbors
will. The number may well be correct right now. So such
findings **do not count toward `deviating`** — they go into `findings` separately.

**The running-head rule has two parts, and both are needed:**

1. every literal number must equal its own page number **or the number of the neighboring
   page on the same spread**;
2. the literal number **must not** equal what an autonumber marker would produce in that
   same frame.

The first part alone misses a frame shifted onto the wrong side of a spread — there
a manual number legitimately equals its own page. The second alone misses a
systematic shift. Both cases are measured defects of the real book, not
hypotheses.

The reference is taken **from the document**: InDesign itself knows a spread's composition, so the rule
works even on a book with running heads on the verso. There is no "left = right minus 1"
constant in the code, and there can't be.

**Table of contents.** "Title ↔ number" pairs are built **geometrically, by baseline**:
there is no structural link between them in the document — they live in different stories,
with no tab stop or shared paragraph. The tolerance is **half the smaller leading**
of the pair, also taken from the document. Two titles within the tolerance of one number produce
`contents-ambiguous`, not a guess. Numbers must **not decrease** in line order:
a decrease produces `contents-out-of-order` — this is not a similarity measure but a fact, because a table of contents
runs in the order of the book.

Level correspondence is declared by the operator (`levelMap`), and it is **not one-to-one**:
one table-of-contents line style can correspond to several heading styles. One heading style mapped to two levels
is a loud error caught before measurement, because the same heading would be
consumed twice.

**Identical findings are collapsed into a single row.** The family returns groups by defect —
`count`, a list of pages (up to 20, with an explicit `pagesTruncated`), and one sample with a
full explanation. Measured, why: on the real book, 91 identical findings would have
cost 33 KB to say one thing; the summary costs 733 bytes. Full addresses are
available through `detail`.

**A count mismatch is often legitimate.** The table of contents is deliberately incomplete — some
headings are intentionally left out of it. Measured: 34 lines with numbers against 42
subheadings in the body, and that is a normal state for the book. `contents-count-mismatch`
says "positional matching was stopped," not "something is broken": stopping is needed,
because at a mismatched count, a one-position shift would make every
subsequent line stale.

**Numbers belong to one level of the table of contents, not to all of them.** In the book that was measured, they appear
only next to entry lines; subsections are heading-only separators with no numbers. Before
building a `levelMap`, it's worth checking what the numbers' baselines actually align with.

### What the tool does not do

- **it does not match the TEXT of titles** in the table of contents against headings. Tables of contents are shortened
  on purpose, and there's nothing to measure a similarity threshold from. The consequence is named honestly:
  a swap of two adjacent lines with close page numbers is not caught
  (a swap with distant ones is caught by the monotonicity check);
- **it does not see tables or footnotes** — an inherited boundary: the measurement walks
  the paragraphs of stories;
- **it does not see orphaned cross-reference marker characters outside a running-head frame.**
  `crossReferenceSources.remove()` does not delete the inserted character, and it keeps
  reading as the number of the page it physically sits on. It's worse than a manual number
  in that it **updates itself** — just not to what it should. In a running-head frame
  it will surface (the number won't match either its own page or the neighboring one); in the body of the
  text it won't: the tool doesn't know what page the reference SHOULD point to;
- **there is no running-head family — and the reason is NOT what was stated here before.** It used to
  say "the measured book had no running head with a chapter title"; that is
  **false, and the measurement corrected it** (probe `H7`, Question 1). Running heads exist in the
  book — on the verso of parent pages, and in **two different styles**
  (`Колонтитул v1` and `Колонтитул v2`). The measurement itself didn't see them: non-overridden
  parent-page items are invisible both to `page.textFrames` and to
  `page.allPageItems` — a separate source, `page.masterPageItems`, is needed. The family
  still doesn't exist, because nobody has built it yet; a future one must know about **both
  styles**, or it will repeat the "searched with one key" mistake.

**A localized InDesign does NOT mute this check** — unlike the `usage` family
in `styles_audit`. Special characters are compared by the `SpecialCharacters`
enumeration, not by English names.

## Preflight: technical file fitness

`preflight_document` runs InDesign's **native preflight** and returns its findings
broken down by category and rule — with the page and Problem/Fix text straight from the
application. Read-only: it creates no profiles, changes none, and touches the document.

**"0 violations" here does NOT mean "the layout is clean," and that's the headline.** Measured on the real working book
2026-08-07: the `[Basic]` profile has **38 rules, of which SIX are enabled**. Among the disabled ones is
`ADBE_ImageResolution`, meaning low image resolution is not checked by default
at all. A tool that just handed back the errors would report "0" and be formally correct and
practically harmful. So the unit of the report here is the pair "what was measured + **with what** it was measured":
`rulesEnabled`/`rulesDisabled`, named `enabledRuleIds`/`disabledRuleIds`, and a mandatory
`caveat`. The same principle that gave `pagination_audit` its `checked`/`notCompared` counters.

**`caveat` is built from THIS measurement, not from memory.** It names the profile used,
its own numbers, and mentions `ADBE_ImageResolution` by name **only when it is actually
among the disabled ones** — otherwise it says the opposite, also from the measurement. Otherwise the caveat's own
advice ("enable the rules you need") would make that very same caveat false.
`preflightOff === true` is reported loudly and separately: a live preflight disabled by the operator means the InDesign
panel stays silent about these same violations.

**The default profile is the DOCUMENT's own working profile** (`preflightWorkingProfile`), i.e.
the reference is derived from the document, not hardcoded as a constant. If the named profile doesn't
exist, the tool refuses and lists the available ones — an empty report would read as "all clean."

**Counters for the parsing itself** — `shapeRecognised`, `rowsSeen`/`rowsParsed`,
`pairsSeen`/`pairsParsed` — sit next to `occurrenceCount`, because without them "no violations" and
"InDesign returned a shape we don't understand" would produce byte-for-byte identical responses.
`processRemoved` says whether the preflight process was cleaned up after itself (it lives in the application, not the
document). The list of cases has a ceiling, and truncation is visible in `occurrencesTruncated {shown, total}`
— on a book with hundreds of images and `ADBE_ImageResolution` enabled, an uncapped response
would cross the 78 KB mark that once knocked the tool out during Phase 4.

**What the tool does not do:** it doesn't enable rules or create profiles (that's a human decision made
inside InDesign itself) and it doesn't invent resolution thresholds — those depend on the print shop. It does not replace
`layout_audit`, `styles_audit`, or `pagination_audit`: preflight judges **technical file fitness**
(fonts, links, overset), not layout systematicity.

Measured facts — `docs/measured-facts-preflight.md`.
### `pagination_apply` — remove the manual number, don't patch it

The eighteenth tool, and the first in the numbering family that **writes**. The idea in one
sentence: a manual number in a running head is replaced with the neighboring-page marker
(`PREVIOUS_PAGE_NUMBER` / `NEXT_PAGE_NUMBER`), so from then on it updates itself.

**The overriding principle — the tool must never write a number different from the one that's
currently in the frame.** Existing manual numbers act as a ready-made oracle:
the tool computes what page a marker would resolve to, and if it doesn't equal
the current number, the frame is left untouched, with the reason named in `skipped`. So a
low coverage rate is not a hazard: it defines the scope of **benefit**, not of safety.

**Three operations, and the order between the first two is mandatory:**

1. **`create-helper-thread`** — builds a service text chain on its own
   layer, `_folio-helper` (`visible = true`, `printable = false`). This is exactly what the running-head
   frame overlaps, and exactly what the marker draws its number from. Returns
   `planId`;
2. **`replace-literals`** — replaces literals with markers. With `route: "auto"`
   it requires `planId` from the first step: the plan carries the chain's **actual**
   coverage, not a promised one;
3. **`repair-helper-thread`** — restores an **already existing** chain after a change in
   the page count: removes extra frames (a second one on a page, orphans off any page),
   adds missing ones, re-threads them in page order, and returns the layer's
   flags. **Idempotent:** a second run in a row produces zeros. It cannot build a chain
   from scratch — that's the first operation's job.

`route` is `"thread"` (overlap with the main text chain), `"helper"`
(service chain), or `"auto"`. `folio.range` (`"backward"` / `"forward"`)
declares the running-head range's direction — it is **not derived** from the book, because a
book with running heads on the verso would flip the rule.

**`dryRun: true` by default.** The dry run shows the named list of
`willWrite` — exactly what will go into the document, in the same order; no copy is
created and nothing in the document changes. `expectedDocName`
is **mandatory** here, unlike in the rest of the write-capable tools: the cost of a forgotten
field is a write into the live book.

Writing goes through its own safety envelope: a copy in `_backups/` before any changes, a single
undo step for the whole batch, verification of **the whole paragraph** and range against the measured
character offset before every write. It fails loudly if there were many eligible frames
and none were written, or if the `total = eligible + skipped` reconciliation
doesn't add up.

#### Boundaries — read before the first run

- **The replacement makes the running head SELF-UPDATING, not CORRECT.** The tool discards
  a wrong number (`oracle-mismatch`) rather than fixing it.
- **After the replacement, literal-based audit on this frame is blind FOREVER.** The whole running-head
  rule depends on "if the paragraph contains literal numbers"; a frame with no
  literals never produces findings. Detectability is kept up by **three new detectors** —
  `folio-marker-unbound` (nothing for the marker to resolve to: in that case InDesign
  doesn't leave a blank and doesn't warn — it prints the number of the **current**
  page), `folio-marker-cross-spread` (resolved, but the pair of numbers isn't two pages of the same
  spread, e.g. "97–97"), and `folio-dormant-duplicate`
  (a frame with a marker on a hidden layer: doesn't print today, but will produce a second running head once
  the layer is turned on). Without these the phase would be **harmful** —
  it would trade a detectable defect for an undetectable one.
- **The service chain must be UNBROKEN.** Measured (probe `H7`, Question
  18): the marker prints the page of the **previous frame in the chain**, not "current
  minus one." Over a chain built only from odd pages, the marker on page 3 printed
  "1," on page 5 — "3," on page 7 — "5." So a frame is created on **every**
  page of the range, not only where a running head exists; a chain with a gap
  would make every marker false-looking while each one looks correct.
- **The chain breaks silently, and that's exactly why there is a FOURTH detector.** A run on a
  copy of the real working book on 2026-08-08 succeeded (84 of 91 running heads
  converted, no printed number changed), and then an operator removed the wrong
  page: service frames were left on **167 of 196** pages, **25**
  running heads started printing the wrong spread's number, and **nobody was warned**. Audit
  only saw the consequence. Now the `folio` family checks the chain itself and has four
  defects: `folio-helper-chain-gap` (a page with no link),
  `folio-helper-chain-unordered` (link order doesn't match page order), `folio-helper-chain-hidden`
  (the layer is hidden — measured to MUTE resolution entirely, and every automatic running head
  silently becomes "N–N"), and `folio-helper-chain-split` (links stitched into more than
  one chain). **The last one matters most:** measured (`H8`, Question 2), that
  duplicating a page in InDesign copies the service frame but does **not** thread
  the copy into the chain — the frame is on the page, the order isn't broken, so
  the rest of the checks stay silent, while the numbers have already drifted.
  If the layer doesn't exist in the document at all, all four **stay silent**: no chain was
  ever built, so there's nothing to break.
- **`create-helper-thread` is NOT neutral on the printed sheet.** Measured by exporting a PDF before
  and after (`tests/integration/pagination-apply.test.ts`): on pages whose
  marker previously had nothing to resolve to, the printed number **changes** —
  "11–11" → "x–11," "21–21" → "20–21." This is a correction of an existing lie, not a
  regression, but it needs to be seen ahead of time. **Replacing literals alone changes no
  character** — this was verified separately, character by character, on every
  page.
- **A locked frame or a locked layer do NOT protect the text.** Measured (Question 19):
  a character replacement goes through without exception both with `frame.locked === true`
  and on a locked layer, at both levels of interaction. The locks are real, though —
  `geometricBounds` and `remove()` on that same frame throw `Object is locked.`;
  InDesign protects the **page item**, not its text. Only **our own**
  handler refuses (`locked-frame`, `locked-layer-frame`), and that's its own decision, not
  a physical restriction from InDesign.
- **The parent-page running head stays broken, and this phase doesn't fix it.**
  `page.masterPageItems` returns ONE object shared by every page with that parent, so
  writing to it would change them all; and a marker in a non-overridden parent-page frame
  of a document chain simply cannot see it (Question 13).
- **Coverage is complete AS OF THE MOMENT OF THE OPERATION, not forever.** A page added
  later gets no service frame.
- **Not supported, each with its own reason in `skipped`:** a page with no partner
  in the spread (`single-sided`), a spread that isn't a pair of pages (`spread-not-pair`),
  a frame with several literals in one paragraph (`multiple-literals`), a page name with no
  number — "iv", "Дод-3" (`unparsable-page-name`), a frame on a
  hidden layer (`hidden-layer-frame`), a locked frame (`locked-frame`) or
  layer (`locked-layer-frame`), the first and last page of the book, which have no neighbor
  (`no-siblings`), a broken chain (`no-neighbour-frame`).
- **A running head with NO service frame found beneath it is skipped — and that's
  the most common `helper`-route failure.** Eligibility is determined **per frame**:
  the number comes from the frame the running head overlaps, not the page it
  sits on. Two running heads on one page get one service frame between
  them (the second goes into `helper.ignoredFolioFrames`), and a `_folio-helper` layer
  deleted between calls makes all of them ineligible. Previously all these states
  silently read as **"eligible"** — and the printed number changed ("2–3" → "3–3").
- **A localized InDesign.** The layer name `_folio-helper` is ours; the
  `SpecialCharacters` names are not, so this boundary is shared with the rest of the server.
- **A run on a copy of the real working book has NOT yet been done.** Everything verified above is
  on a fixture and temporary documents. Making and naming a copy of the real working book is up to the
  user.

## Safety model

Six tools write to the document: `corrections_apply`, `typography_apply`,
`composition_apply`, `bibliography_apply`, `pagination_apply`, and `indesign_run_jsx`. The first four
write edits through one and the same JSX handler — `apply_edits` (invoked via `runWrite` in
`src/bridge/envelope.ts`), so their safeguards are identical. `pagination_apply` has **its own**
handlers (`pagination-write.jsx`), and its safety envelope was **rebuilt**, not inherited: a
copy before changes, a document-name check before that copy, one undo step per batch, a check of
the text before every write. One difference worth knowing: `expectedDocName` is
**mandatory** for it, and `dryRun` defaults to `true`. The fifth, `indesign_run_jsx`, doesn't use the
shared handler and has no safeguards.

`corrections_apply`, `typography_apply`, and `composition_apply` are tools with safeguards.
Before any write, the `apply_edits` handler checks the active document's name against the one for
which the plan was built (or the measurements taken), and refuses to write if it isn't the
same document — the check happens even BEFORE the copy is made.

This check guards against a "measured one thing — writing to another" mismatch, but by itself it knows
nothing about your intent: if the active document isn't the right book, the tool will happily measure it
and happily write into it. So all three accept an optional **`expectedDocName`** — the name of the document
you MEAN. If one is named and it doesn't match the measured one, the write doesn't happen at
all, before the copy is made; if none is named, behavior doesn't change. It's deliberately not made
mandatory: that would force you to first look up the name every time for a safeguard that
already works in the normal case.

Beyond that, four unconditional safeguards apply:

1. **A document copy in `_backups/`** — made before any changes, outside the undo step.
2. **InDesign dialogs disabled** — for the duration of the write (modal windows about links, fonts, or volume
   permissions would otherwise block the call and leave the document in an unknown state).
3. **One undo wrapper for the whole batch of edits** — all edits from one `corrections_apply` call
   land as a single history step, so the whole batch is undone with exactly one Cmd+Z.
4. **A check of the actual text before every write** — if the text at the edit position is no longer the same
   one that was there during `corrections_plan` (someone changed the document), the edit is skipped and
   reported, rather than written blind.

`indesign_run_jsx` is a tool with almost NO safeguards, and that's a deliberate choice, not an oversight.
It runs arbitrary ExtendScript against the live document: **no copy in `_backups/`, no
document-name check, no text check before writing**. It DOES have an undo step (every call
is wrapped in `IDMCP.withUndo` — `src/jsx/run.jsx`), but that's the tool's own baseline,
not a guarantee reconciled against a plan: a script with several `indesign_run_jsx` calls in a row is
NOT a single atomic batch the way a `corrections_apply` batch is. The rest of the safety (copy,
document check, text check) must be provided by the script you pass to it yourself. That's exactly
the tool's purpose (spec §6): one-off tasks from Phases 2–4 not yet covered by dedicated tools.
The script comes from
the session operator, so none of the four safeguards above apply to it — treat
every `indesign_run_jsx` call like manually running a script inside InDesign itself:
save the document before the call, so there's something to revert to.

`corrections_apply`'s safeguards protect against common mistakes (wrong document, a stale
plan, a batch that's awkward to partially roll back) — not against deliberate circumvention — so it's important
to know this model's boundaries too. The three facts below were measured on live InDesign in Task 6 and Task 8:

- **A locked layer does NOT protect the document from this tool.** Verified: `layers[0].locked
  = true`, and then writing to text on that layer goes through without exception — locking a layer doesn't
  stop ExtendScript from writing to it. If a layer is locked to protect its content, that
  expectation does not hold for `corrections_apply`. **Phase 7 re-measured this and extended the
  conclusion** (probe `H7`, Question 19): locking the **frame itself** (`frame.locked === true`) doesn't protect
  the text either, at both levels of interaction. The locks aren't fake, though —
  `geometricBounds` and `remove()` on that same frame throw `Object is locked.`: InDesign protects the
  **page item**, not its text. `pagination_apply` refuses to write in both cases — but that's **its own
  policy**, not an InDesign restriction, and it doesn't extend to the other tools.
- **`_backups/` rotates automatically, but only the tool's own copies.** Every `corrections_apply`
  call that applied at least one edit is guaranteed to create a new copy file
  (so a second batch of edits within the same minute doesn't overwrite the first copy), and then keeps 10
  of the most recent copies, whose name matches EXACTLY the format `<base>_do-pravok_YYYY-MM-DD-HHMM[-N].indd` —
  older copies matching this same format get deleted. A file with the same prefix but named
  by hand (for example, your own `..._do-pravok_20260731-vychytka.indd`), doesn't fall under this
  stamp and is never up for deletion. If rotation fails (the file is locked by
  cloud sync or another process), the edits are still applied — the `corrections_apply` report
  reports it via the `backupRotationError` field; the error isn't swallowed silently.
- **The document must be saved to disk before edits are applied.** There's nothing to make a copy
  from into `_backups/` if the document has no file on disk yet — the tool will refuse to
  write. Save the document (Cmd+S) before your first `corrections_apply` call.

## Development

```bash
npm test              # unit tests, no InDesign required
npm run test:integration   # requires a running InDesign
npm run typecheck
```

Both test scripts are scoped by Vitest project (`--project unit` /
`--project integration`), not by a positional path to a folder. This is not cosmetic:
a positional path baked into the npm script itself is NOT replaced by what's passed after
`--` — it's added alongside it — and `npm run test:integration -- tests/integration/x.test.ts`
would silently run the ENTIRE integration suite (each test against a live document)
instead of a single file. With `--project`, paths after `--` genuinely narrow the run:

```bash
npm run test:integration -- tests/integration/bridge.test.ts
npm run test:integration -- tests/integration/bridge.test.ts tests/integration/find.test.ts
```

Files in `src/jsx/` are ExtendScript ES3: only `var`, `function`, plain loops.
All matching and parsing logic lives in TypeScript, so it can be tested without InDesign.

### Integration tests write to a document

`tests/integration/corrections.test.ts` and `tests/integration/end-to-end.test.ts` create
their own temporary fixture document (`__fixture_make_saved`) and work only with it: before
every write or read that relies on the active document, its name is checked, and
the fixture is closed strictly by exact name. If your working layout happens to be open
in InDesign at the same time, these tests don't touch it — but that's precisely why these
checks should never be relaxed for convenience.

## What still has no dedicated tool

Automatic typography rules apply to the `new` field during corrector edits
(B4, Phase 2, "How corrections are applied" section).

**Bulk typography passes across the whole document no longer belong here.** Until
2026-08-26 this section told the reader that such passes "are tasks for later
phases" and that "until they exist, such tasks go through `indesign_run_jsx`".
Both halves had been false for a long time: `typography_audit` and
`typography_apply` do exactly this job, and they do it with a backup copy, an
`expectedDocName` reconciliation and a text check before every edit —
`indesign_run_jsx` has none of the three. The paragraph therefore steered
readers away from two safe tools and towards the single unguarded one, which is
the opposite of what the safety model above is for.

What genuinely has no dedicated tool yet: **bulk style operations** (renaming,
merging or re-basing paragraph styles across a document) and **export** (PDF,
package, preflight-to-file). Those still go through `indesign_run_jsx` — read
"A tool with no safeguards" above before you do, because that route makes no
backup and reconciles nothing.
