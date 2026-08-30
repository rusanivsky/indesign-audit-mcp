# Measured facts — Phase 2 (H1)

Date: 2026-07-31 (fix round 2). InDesign 21.4.1.4. Document:
«Book-A 260731-0055.indd», 196 pages, 550 stories, **217,493 characters**
and **5,251 lines** total across the whole document (both numbers are the sum
of `.length` over the collections across all stories, a cheap operation, not
an element-by-element walk; computed directly in the probe, item 0).

The probe was run via `scripts/run-probe.mjs` → `scripts/probe-composition.jsx`
(the `run_script` handler, `src/jsx/run.jsx:6`). The full raw JSON of all
three runs is in
`.superpowers/sdd/2026-07-31-indesign-mcp-phase2/task-1-report.md`.

**What changed after fix round 1:** the first version of the probe used
`doc.stories[0]` in items 2–4, and in this document the story at index 0
turned out to be a microscopic utility frame (page numbering, 3 characters)
— the measurement came out unusable, and more importantly, **the committed
file would have reproduced this defect on every future run**. The probe was
reworked: item 0 now searches once for the largest story in the document
(33,522 characters, 560 lines), and every subsequent item works on it
specifically. A measurement of line-based traversal cost was added
(alongside character-based), and hyphenation exclusion is now read on three
different body-text styles, not a random first paragraph.

**What changed after fix round 2:** the review found two issues around
`Line.endHorizontalOffset`. First, `MeasurementUnits.POINTS` was only
pinned down inside item 1 (`finally` restored the ambient unit BEFORE items
2–3) — line coordinates and the line-based traversal were read in an
unguaranteed unit. Second, the difference `endHorizontalOffset −
horizontalOffset of the last character` (≈1.14 pt in the previous round)
didn't match the spacing between adjacent characters from item 1 (3.2–8.4
pt) — and the previous facts document called this "confirmation" even
though the numbers didn't match. **Both issues turned out to be linked:
the 1.14 pt figure wasn't in points, it was in millimeters** (because the
unit fix didn't reach item 2) — after fixing the unit, the same line gave
3.22 pt, already much closer to the expected range. But further
investigation (below) revealed one more layer of the problem: the first
line that qualified by length happened to end with a control character
(`SpecialCharacters.FORCED_LINE_BREAK`, then the paragraph-end character
`\r`), not an ordinary letter. The probe now filters out such lines and
looks for one that ends with a genuine printable glyph.

## horizontalOffset on Character

- Available: **yes**.
- Units: points (`points`) — explicitly pinned via
  `app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS` for the
  duration of the probe, with the previous value restored in `finally`.
- Sample values (first 12 characters of the largest story, 33,522 characters):
  `617.95, 626.13, 633.74, 642.12, 649.07, 652.29, 659.43, 662.65, 670.49, 673.71, 680.28,
  686.72`. The values increase monotonically, and the spacing between
  adjacent characters (≈2–9 pt) matches the glyph widths of the book's
  Cyrillic body text — behavior consistent with expectations.
- **Conclusion for composition_audit (Phase 3):** the property reads
  directly, in predictable units, with no workarounds, on real body text
  (not a utility frame). The tool's intended shape (character coordinates →
  line density/looseness) is technically feasible. The limitation isn't
  the property's availability, but the cost of traversal (see below), and
  the need to explicitly set POINTS before reading.

## Line.endHorizontalOffset — confirmed by a direct measurement (round 2)

- Available: **yes**, no error on read.
- The measurement unit is now pinned **once for the whole probe**
  (`MeasurementUnits.POINTS` is set before item 0 and restored in `finally`
  at the end of the whole script, rather than separately in item 1) —
  `out.measurementUnit: "points"` is written explicitly into the result.
  This closes the review finding: previously items 2–3 were read after the
  ambient unit had already been restored.
- **The first attempt (without a "genuine glyph" filter) gave a misleading
  result twice in a row**, and this is worth documenting honestly in its
  own right:
  - Run A: the selected line ended with a
    `SpecialCharacters.FORCED_LINE_BREAK` character (`typeof contents ===
    "object"`, `constructor.name === "Enumerator"`, not a string) — a
    forced line break inside a paragraph. `endHorizontalOffset −
    horizontalOffset` for this "character" = `3.21994018554688` pt.
  - Run B (after excluding non-string `contents`): the selected line ended
    with `"\r"` (paragraph end) — also not a printable glyph. The
    difference came out to **the exact same number**:
    `3.21994018554688` pt. It appears InDesign gives line/paragraph-end
    control characters an identical synthetic "width" (likely equal to the
    width of a space character in this font and point size — in item 1 the
    3.220 pt step recurs several times between adjacent characters in the
    sample, which matches the width of a space in this text).
  - The probe was reworked: the line search now explicitly excludes
    `"\r"`, `"\n"`, and the Unicode line/paragraph separators (U+2028,
    U+2029 — these had to be built via `String.fromCharCode`, because a
    literal character in an ES3 string literal trips the same trap
    described for `params.json` in `runner.ts`), and takes the first line
    longer than 20 characters that ends with a genuine printable glyph.
- **Run C (a clean measurement, a printable glyph at the end of the
  line):** a 72-character line was selected, ending in the letter "и"
  (second-to-last character: "с").
  - `horizontalOffset` (line start): `617.952755905512`
  - `endHorizontalOffset` (line end): `982.546750046137`
  - `horizontalOffset` of the last character ("и"): `976.428799606684`
  - **Difference `endHorizontalOffset − horizontalOffset(last)` =
    `6.11795043945312` pt.**
  - An independent check (not relying on `endHorizontalOffset`): the width
    of the second-to-last character ("с"), measured as
    `horizontalOffset(last) − horizontalOffset(second-to-last)` =
    `5.48541259765625` pt.
  - Both numbers (6.12 and 5.49 pt) land confidently in the same range as
    the spacing between adjacent characters in item 1 of this same run
    (3.2–8.4 pt for ordinary letters, not counting the recurring 3.220 pt —
    likely spaces). This is no longer "roughly the same order of
    magnitude" — it's a direct numeric match with no rounding in the
    convenient direction.
- **Conclusion for composition_audit (Phase 3):** `endHorizontalOffset`
  behaves exactly as a line boundary (the position AFTER the last glyph),
  and this is confirmed by a direct, non-circular measurement on a line
  that genuinely ends in a printable letter — not by appeal to
  expectation. Status: **confirmed**, now on stronger footing than in the
  first fix round. A useful side finding: searching for the "first
  suitable line" without filtering on the last character's type is a
  fragile technique (it fell into control characters twice in a row in
  this document); Phase 3 should build the same guard (excluding `\r`,
  `\n`, U+2028/U+2029, and any non-string `contents`) into any code that
  reads a line boundary via its last character.

## Traversal cost: character-by-character vs. line-by-line

The probe measured both approaches on the same largest story (33,522
characters, 560 lines), across several separate runs over both fix rounds
(timing variance between runs is itself a measured fact, not a one-off
number):

| Measurement | Round 1, run 1 | Round 1, run 2 | Round 2 (after the unit fix) |
|---|---|---|---|
| 1000 characters, `horizontalOffset` | 164 ms (0.164 ms/char) | 270 ms (0.27 ms/char) | 170 ms (0.17 ms/char) |
| 560 lines (all in the story), `horizontalOffset`+`endHorizontalOffset` | 428 ms (0.764 ms/line) | 239 ms (0.427 ms/line) | 224 ms (0.4 ms/line) |

Average line length in this story: 33,522 / 560 ≈ 59.9 characters. Round
2's numbers are consistent with round 1's range — pinning the measurement
unit had no effect on traversal cost (as expected: it affects coordinate
values, not the number of operations).

**Cost comparison for covering the SAME amount of text:**
- Line-by-line traversal of the whole story (560 lines): 224–428 ms —
  measured directly.
- Character-by-character traversal of the whole story (33,522 characters),
  extrapolated at the rate from the same table:
  33,522 × 0.164 ≈ 5,498 ms; 33,522 × 0.27 ≈ 9,051 ms.
- Ratio: line-by-line traversal is **≈13–38x** cheaper, depending on the
  run. The spread is wide (a noisy measurement from single runs), but the
  order of magnitude is stable: **at least an order of magnitude cheaper**,
  not just tens of percent.

**Extrapolation to the whole document** (217,493 characters, 5,251 lines —
real, not estimated numbers):
- Full character-by-character traversal of `horizontalOffset`: 217,493 ×
  0.164…0.27 ms ≈ **36–59 seconds**. (Consistent with the earlier rough
  measurement of 31–70 s from the first round.)
- Full line-by-line traversal of `horizontalOffset` + `endHorizontalOffset`:
  5,251 × 0.4…0.764 ms ≈ **2.1–4.0 seconds**.

- **Conclusion:** line-by-line traversal (by `Line`, not by `Character`)
  covers the whole document within a few seconds — an order of magnitude
  faster than character-by-character, and entirely acceptable for a
  synchronous `run_script` call. This changes the design of
  `composition_audit`: **batched reading by page/frame is no longer a
  mandatory condition for a baseline pass**, if the tool uses line-level
  metrics (line width from `endHorizontalOffset - horizontalOffset`,
  compared against the column width) as a first, cheap filter.
  Character-by-character traversal (tens of seconds for the whole
  document) remains necessary only as a **second, targeted pass** — for
  characters inside lines that the line-level filter has already flagged
  as suspicious (too tight or too loose relative to the column). A
  two-stage architecture (a cheap line-level scan → a targeted
  character-level parse of only the flagged lines) looks feasible for
  Phase 3 and likely removes the need for batched reading in a typical run
  altogether.
- **A caveat on precision:** both runs show noticeable spread
  (character-by-character: 164 vs. 270 ms; line-by-line: 428 vs. 239 ms —
  not monotonic in one direction). This is a measurement on a live app
  with no control over background load, so the numbers given are an order
  of magnitude, not an exact constant. Timeout design for Phase 3 should
  build in a margin (e.g. planning around the worse of the two runs, not
  the average).
- **Unchanged conclusion from the first round:** `doc.stories[0]` is an
  unreliable way to find a "typical" story to measure. In this document the
  story at index 0 is a utility one (page numbering), not body text. The
  probe now explicitly searches for the largest story (item 0) instead of
  relying on the index — this is exactly the change this fix round called
  for.

## Hyphenation settings — now on body-text styles

Read on three different paragraph styles found in the largest story (the
first three distinct, non-empty styles in order of appearance in the text,
not an arbitrary paragraph):

| Style | composer | hyphenation | min / desired / max word spacing |
|---|---|---|---|
| «Питання в інтерв'ю» | Adobe Paragraph Composer | `false` | 80 / 100 / 133 |
| «Основний текст L» | Adobe Paragraph Composer | `true` | 80 / 100 / 133 |
| «Основний текст F» | Adobe Paragraph Composer | `true` | 80 / 100 / 133 |

No read errors on any of the three styles.

- **Conclusion for composition_audit (Phase 3):** every hyphenation field
  reads without exceptions on the book's real body-text styles, not just
  on a utility one. The values of `minimumWordSpacing` /
  `desiredWordSpacing` / `maximumWordSpacing` turned out to be **identical
  across all three styles checked** (80/100/133) — in this document they
  appear to be inherited from a shared parent style or a fixed publisher
  standard, and don't vary between «Питання в інтерв'ю» and «Основний
  текст». Only `hyphenation` differs (off for interview text, on for body
  text). This is an honest, unadjusted result: if Phase 3 planned to use
  the spread in word-spacing bounds between styles as a signal for "what
  counts as normal density for this style," this document offers no such
  signal — the bounds are the same everywhere. The signal is more likely
  to come from comparing a line's ACTUAL word spacing against the single
  shared 80–133% range, rather than against per-style individual bounds.

## Check: did the document stay unchanged

This was checked across all three rounds (the coordinator accepted the
first two without comment; here it's the same check after running the
round-2 reworked probe, including intermediate runs that failed with an
`Unterminated string constant` error, along with the accompanying
diagnostics):

- The window title still shows the "unsaved" asterisk:
  `*Book-A 260731-0055.indd @ 123% [GPU Preview]` — both before and
  after every run in this round.
- The first item in InDesign's Edit menu still shows **`Undo Typing`** —
  meaning the last action InDesign remembers for undo is still ordinary
  text entry by the user, not any of our undo-step names. Checked after
  every new run in this round (including the run that failed on a JSX
  syntax error — and one that failed before writing its result also
  leaves no undo step, because `IDMCP.run` catches the exception BEFORE
  writing to history).
- `doc.modified === true` (checked via a direct read-only query to
  InDesign) — the same state as in previous rounds, unchanged in either
  direction.
- **Conclusion:** the "unsaved" asterisk is a state that existed in the
  user's document before work on this task began (an ordinary unsaved edit
  in a layout that's been worked on for months). None of the runs in any
  round (three versions of the official probe, several additional
  read-only measurements, and one diagnostic that failed on a syntax
  error) added its own step to the undo history or changed the document.
  `Cmd+Z` was never needed.

## What remains unmeasured / for next time

- The two-stage architecture (line-level filter → targeted character-level
  parse) is a hypothesis, grounded in this measurement but not verified in
  practice: it hasn't been measured how many lines typically end up
  "suspicious" on a real book page, or whether the number of targeted
  passes turns out too large due to false positives from the line-level
  filter. This is already a Phase 3 design question, not a recon one.
- Word spacing values (80/100/133) were only checked on three styles from
  one story; it's not been checked whether the document has styles with
  different bounds (e.g. a heading, epigraph, or caption style) — if such
  styles exist, they might give a more meaningful difference to compare
  against.
- The spread in timing measurements (13–38x for the line/character ratio)
  hasn't been investigated — the cause of the spread (InDesign caching,
  background macOS load, cold/warm `osascript` invocation) remains
  unknown; for Phase 3 this means budgeting a margin into timeouts, not an
  exact formula.
- It hasn't been established why InDesign gives line/paragraph-end control
  characters (`FORCED_LINE_BREAK`, `\r`) exactly this synthetic width
  (3.21994… pt) — the hypothesis "equals the width of a space in this font
  and point size" is plausible (it matches the recurring 3.220 pt step in
  item 1's sample), but hasn't been checked by a direct measurement of a
  space character's width on its own. This isn't critical for Phase 3
  (control characters should be excluded from "line density" analysis
  anyway), so it wasn't measured further.
