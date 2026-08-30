# Measured Facts — Phase 3 (H3)

Date: 2026-08-04 (fix round 1). InDesign 21.4.1.4 (`Adobe InDesign 2026`). Document:
**«Book-A 260804-0141.indd»** — the same manuscript as in Phase 2, a fresher copy
(the date-stamp is in the filename, not a different book).

Largest story in the document: **33,532 characters**, **561 lines** (Phase 2, on the copy from
260731, measured 33,522 / 560 — the text grew slightly over those days, as is expected in a
live document).
All measurements below were taken on this story; `doc.stories[0]` in this document is a
service frame with page numbering — a Phase 2 finding — and probe H3 accounts for it.

Unit of measurement — points, set once for the whole script
(`app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS`) and restored in `finally`.
This is the only thing the probes ever assign, and it is an application setting, not document
content.

**Probes** (all read-only, all via the `run_script` handler, `src/jsx/run.jsx`):

| File | What it proves |
|---|---|
| `scripts/probe-calibration.jsx` | the probe from the Task 1 brief, transcribed verbatim |
| `scripts/probe-calibration-diag.jsx` | space-width distribution; hypothesis H1 check; density histogram |
| `scripts/probe-calibration-why.jsx` | cause of the outliers in paragraphs 86 and 130; independent check of "stretched" lines |
| `scripts/probe-calibration-batch.jsx` | batching `everyItem()` over 60 lines instead of one |
| `scripts/probe-calibration-measure.jsx` | effective measure and evidence for ε; density broken down by `justification` |

**What changed in fix round 1.** The review independently reproduced every number from the
first round (digit-for-digit match) and added two checks that back up the conclusion: space
width scales with point size to within 6e-7 pt, and the "clean" spread of 0.00058% is exactly
1/65536, i.e. 1–2 ULP of InDesign's fixed-point representation. Five things were fixed in the
presentation, not in the numbers: gate labeling ("triggered", not "passed"), the undefined ε
and "column width", an overly generous percentile-metric recommendation, an unremarked
`p25 = 1.000` artifact, and two supporting probes that had been left in the scratchpad. Plus a
minor fix: the outlier-list limit was cut off at 12 out of 18 outliers, so the report called six
of them measured when they had actually been dropped.

---

## Question 1: does `everyItem()` batch

**Yes, and the values match element-for-element.**

The main probe measured this on a single 66-character line: `returnedArray: true`,
`count: 66`, **5 ms** batched vs. **24 ms** per-element, `matchesPerItem: true` (tolerance
0.001 pt). Both numbers sit at the edge of the timer's resolution, so the 4.8× ratio from one
short line is not a fact. The measurement was repeated on **60 lines / 3,764 characters**
(`scripts/probe-calibration-batch.jsx`), four runs:

| Run | Batched, ms | Per-element, ms | Speedup | Lines with divergence |
|---|---|---|---|---|
| 1 | 163 | 1,527 | 9.37× | 0 |
| 2 | 181 | 1,664 | 9.19× | 0 |
| 3 | 181 | 1,648 | 9.10× | 0 |
| 4 | 160 | 1,552 | 9.70× | 0 |

An independent reviewer run gave **9.80×**. So the observed range across five runs is
**9.1–9.8×**; the correct phrasing is "roughly an order of magnitude," not a fixed constant.
Rates: 0.0425–0.0481 ms/char batched vs. 0.412–0.442 ms/char per-element.
The per-element rate agrees with Phase 2 (0.164–0.27 ms/char) by order of magnitude;
Phase 2 already documented the run-to-run spread on the live application.

- **On match precision.** All four runs show **0 divergences across 3,764 characters at a
  1e-6 pt tolerance**. This is "functionally exact," not "bit-identical": bit-representation
  equality was not checked, only that the difference is below 1e-6 pt. For comparison,
  1 ULP of InDesign's fixed-point representation is 1/65536 ≈ 1.5e-5 pt, so a 1e-6 pt tolerance
  is **stricter than the coordinate grid's own step**, and a match within it means the same
  value.
- **Conclusion:** batching makes the walk roughly an order of magnitude cheaper and is not an
  approximation. Extrapolated to the whole largest story (33,532 characters): ≈1.4–1.6 s
  batched vs. ≈14–17 s per-element.
- **Consequence for Task 6:** `composition_measure` must read `horizontalOffset` and
  `contents` exclusively via `.everyItem()`, line by line. Per-character access in a loop is
  the sole reason Phase 2 considered the per-character pass expensive; with batching, that
  cost drops by nearly an order of magnitude, and the Phase 2 two-stage architecture becomes
  more of an optimization than a requirement.

---

## Question 2: is the calibration stable (TASK GATE)

### Gate status: TRIGGERED → escalated → lifted by coordinator decision

The plan's formal criterion — "spread within a single style greater than ≈15% → stop and
notify the coordinator, revisit spec §4.2 before Task 6." The measured `spreadPct` on the
"Основний текст F"@11.5 style — **88.47%**, i.e. **the criterion triggered**. The action
prescribed by the plan was carried out: work stopped, the coordinator was notified, §4.2 was
revisited before starting Task 6. The breakdown below showed that it was the metric that
triggered, not the calibration, and the coordinator lifted the gate.
**This is not "gate passed" — it is a gate that triggered and was lifted by a deliberate
decision.**

### The numbers themselves

Space width, measured on **the last lines of paragraphs** (which, per spec §4.2's assumption,
are not excluded, so their spaces sit at 100% of the intended tracking). The first 400
paragraphs of the largest story, grouped by `(paragraph style, point size)`:

| Style@size | Samples | Median, pt | min, pt | max, pt | `spreadPct` (min–max) | p05–p95 spread | Within ±1% of median |
|---|---|---|---|---|---|---|---|
| «Питання в інтерв'ю»@14 | 77 | 3.21994018554688 | 3.21994018554688 | 3.21994018554688 | **0%** | 0% | 77 / 77 |
| «Основний текст L»@11.5 | 87 | 2.64494323730469 | 2.64492797851562 | 2.64495849609375 | **0.00115%** | 0.00058% | 87 / 87 |
| «Основний текст F»@11.5 | 470 | 2.64494323730469 | 1.40336608886719 | 2.64495849609375 | **88.47%** | 0.00058% | 452 / 470 |
| «Підпункти в основному тексті -1»@11.5 | 54 | 2.64494323730469 | 2.64494323730463 | 2.64495849609375 | **0.00058%** | 0% | 54 / 54 |

The important thing in this table is not the spread but that **the median for all three
11.5 pt styles matches to the fifteenth digit**: 2.64494323730469 pt. Three different
paragraph styles, independent samples of 87, 470, and 54 — and the same number. The review
added two supporting checks: space width scales with point size to within 6e-7 pt
(3.21994 / 14 = 2.64494 / 11.5 to within 6e-7), and the "clean" spread of 0.00058% is exactly
**1/65536**, i.e. 1–2 ULP of InDesign's fixed-point representation. In other words, the three
styles do not give "nearly the same" number, but the same number to within the step of the
coordinate grid.

### The 88% spread — what it actually is

`spreadPct` is computed as `(max − min) / min` and is therefore a **worst-sample statistic**,
not a measure of distribution:

- **452 of 470 samples** of "Основний текст F" lie within ±1% of the median.
- All **18** rejected samples come **from two paragraphs**, and this is now **measured, not
  inferred**: after raising the outlier-list limit (it was 12 out of 18 outliers), full
  attribution is available — **9 samples from paragraph #86 and 9 from paragraph #130**,
  widths 1.40337 and 2.14392 pt, `justification: LEFT_JUSTIFIED` in both.
- The p05–p95 spread for this same style is **0.00058%**, the same as for styles with no
  outliers.

The cause of the outliers was measured directly (`scripts/probe-calibration-why.jsx`).
Paragraph #86, text-frame width 368.503937 pt, one column, `LEFT_JUSTIFIED` (justify with last
line left), Adobe Paragraph Composer, word spacing 80/100/133:

| Line | Chars | Last char | Line width, pt | Space width, pt | Ratio to 2.64494 |
|---|---|---|---|---|---|
| 0 | 74 | space | 352.517 (has first-line indent 15.99) | 2.69111 | 1.018 |
| 1 | 68 | space | 368.504 | 4.58300 | 1.733 |
| 2 | 71 | space | 368.504 | 5.10767 | 1.931 |
| **3 (last)** | 73 | `<CR>` | **368.504 = frame width** | **1.40337** | **0.531** |

The last line of the paragraph has **a width exactly equal to the column** and spaces
compressed to 53% — i.e. it **is justified**, despite `LEFT_JUSTIFIED`. Paragraph #130 is the
same case, even more pronounced: its last line's width is **368.754 pt against a measure of
368.504 pt**, i.e. the line is even slightly wider than the measure, and its spaces are
compressed to 81%.

**Spec §4.2's assumption ("the last line is not excluded") does not always hold** — in this
document it is false for 2 of 131 last lines (1.5%) and produces samples that are 47% wrong.
The spec anticipated a related edge case ("a style with justification on every line including
the last"), but as a property of the **style**; here it is instead a property of an
**individual paragraph** within a style that otherwise behaves normally. A line-level filter
is therefore needed, not a style-level one.

### One fix to §4.2, one confirmation, one note

**Fix (the only one).** Add a filter to the §4.2 calibration sample: **a paragraph's last line
is taken into calibration only when it is shorter than the effective measure by at least ε**.
A line that reaches the measure is considered effectively justified and discarded. The
rationale for ε follows in the next section.

**Confirmation (not a fix).** The spec already requires the median — line 108: "for each
(paragraph style, point size) pair, take the **median** of the space width." The measurement
confirms this and shows the cost of the alternative: `min` would give 1.40 pt instead of
2.64 pt, i.e. a 47% error in every downstream ratio. Nothing needs to change in §4.2 here.

**Note (not a fix).** `spreadPct` does not exist in the spec — it appears only in the probe
from the plan (`docs/superpowers/plans/2026-08-04-indesign-mcp-phase3.md`, line 184) and in
the gate criterion (line 278). So it would never have made it into the code. The note is for
future gates: the `(max − min) / min` metric is unsuitable as a stability criterion because it
breaks on a single sample.

### ε and "effective measure": what Task 6 must actually return

**"Column width" is an ambiguous term, and `frame.geometricBounds` is not fit for this
purpose.** The diagnostic probe compared line width directly against
`geometricBounds[3] − [1]`, and the match only held because in this document every correction
is zero: frame insets 0, one column, `leftIndent` = `rightIndent` = 0. That this is
insufficient is visible from the data itself: line 0 of paragraph #86 has a width of
352.5165 = 368.504 − 15.987, where 15.987 is the first-line indent, even though its right edge
is shared with the rest of the lines. A right indent, a frame inset, or a multi-column frame
would break the comparison against `geometricBounds` just as silently.

**The value the measurement layer is obligated to return is the paragraph's EFFECTIVE
MEASURE:**

```
effective measure = (frame width
                     − left frame inset − right frame inset
                     − column gutter × (number of columns − 1)) / number of columns
                    − left paragraph indent − right paragraph indent
```

and for a **single-line** paragraph (where the last line is also the first) the first-line
indent must also be subtracted. It is this value, not the frame width, that §4.3 lists as
something the measurement layer returns upward ("column width") — the wording should be
clarified, because a literal "column width" in a multi-column frame with insets does not equal
any of the values the detector needs.

**Evidence for ε** (`scripts/probe-calibration-measure.jsx`, 131 last lines of paragraphs,
`measureErrors: 0`). Gap = effective measure − line width:

| Value | Value, pt |
|---|---|
| Genuine last lines (spaces within ±1% of median), n = 129 | |
| min | **1.88e-9** |
| next above min | **4.12069726178026** |
| p05 | 7.77145409771776 |
| p25 | 79.2159731406865 |
| p50 | 158.045212032288 |
| max | 297.723297359437 |
| Contaminated last lines (paragraphs 86 and 130), n = 2 | **−0.25050353816175** and **1.88e-9** |

The tightest genuine last lines: paragraphs 91 and 116 — gap 1.88e-9 pt (i.e. exactly at the
measure), then paragraphs 61 (4.1207), 53 (4.1556), 45 (4.8338), 83 (5.6960), 49 (7.7715).

The key point: **there is no sample between 1.88e-9 pt and 4.12 pt**. That empty band
≈4.1 pt wide is exactly what bounds ε on both sides — previously ε had no upper bound at all.

- **From below**, ε must exceed numeric noise: 1.88e-9 pt is zero within the representation,
  and paragraph #130 actually overshoots the measure by 0.25 pt, so ε must be positive and
  noticeably larger than 0.25 pt.
- **From above**, ε must stay below 4.12 pt, or genuine last lines will start being dropped.
- **Recommendation:** express ε **not as an absolute constant but in units of the style's
  natural space width** — "a last line is considered justified if it falls short of the
  measure by less than one natural space width." Here that is 2.645 pt (at 11.5 pt) and
  3.220 pt (at 14 pt) — both inside the empty band. An absolute constant of 2 pt also works
  on this document, but does not carry over to other sizes and measures.
- **Cost of the filter:** 4 of 131 last lines (3.1%) are discarded — paragraphs 86 and 130
  (contaminated, the whole point of the filter) and 91 and 116 (genuine, with natural spaces,
  lost for nothing). The filter is deliberately over-conservative in the safe direction:
  losing a genuine sample costs nothing, since the estimator is a median over hundreds of
  samples, while admitting a contaminated one costs a 47% error.

### Stability metric for Task 7: "share within ±1% of median," not p05–p95

In the first round these two metrics were presented as equivalent. They are not:

- Outliers are **18 of 470 = 3.83%**. p05 sits at 5%. The margin is **≈1.2 pp, i.e. 5–6
  samples**.
- A document with ~6% such paragraphs **would shift p05 itself into the contaminated zone**,
  and the metric would start reporting "clean" while going blind to the very thing it was
  built to catch. This is a sharp cliff at the 5% threshold, not a gradual degradation.
- "Share of samples within ±1% of median" degrades smoothly: at 6% outliers it simply reads
  94%, and that is visible.

**For Task 7, the recommendation is share within ±1% of median.** The percentile spread can
be kept as a reference number, but not as a criterion.

---

## Question 3: do the 80/100/133 thresholds carry signal

Comparing a line's actual median space width against its style's calibrated "natural" width.
All lines of a paragraph were counted **except the last**, across the first 400 paragraphs:

| Measurement | Value |
|---|---|
| Lines checked | 399 |
| Out-of-range lines (`≥133%` or `≤80%`) | **220** |
| Uncalibrated lines (<3 samples per style) | 1 |
| **`pctOutside`** | **55.14%** |

### The denominator was mixed — a breakdown by `justification`

The first round never read `paragraph.justification`, so the denominator included
non-justified paragraphs, where every line trivially reads exactly 1.000 and **can never be
flagged**. This is now measured (`scripts/probe-calibration-measure.jsx`):

| `justification` | Lines | Out of range | `pctOutside` | Lines exactly at 1.000 | ≥133% | ≤80% |
|---|---|---|---|---|---|---|
| `LEFT_ALIGN` (not justified) | 27 | 0 | **0%** | **27 (all)** | 0 | 0 |
| `LEFT_JUSTIFIED` (justified) | 372 | 220 | **59.14%** | 0 | 192 | 28 |

Broken down by style:

| Style@size | `justification` | Lines | Out of range | Exactly at 1.000 |
|---|---|---|---|---|
| «Питання в інтерв'ю»@14 | `LEFT_ALIGN` | 14 | 0 | 14 |
| «Підпункти в основному тексті -1»@11.5 | `LEFT_ALIGN` | 13 | 0 | 13 |
| «Основний текст L»@11.5 | `LEFT_JUSTIFIED` | 65 | 41 (63.1%) | 0 |
| «Основний текст F»@11.5 | `LEFT_JUSTIFIED` | 307 | 179 (58.3%) | 0 |

- **The genuine share among justified lines is 59.14%, not 55.14%.** The direction of the
  correction **strengthens** the conclusion: 55.14% was diluted downward by lines that
  structurally can never be flagged.
- **The `p25 = exactly 1.000` from the first round is an artifact of this same dilution.**
  The 27 non-justified lines sit exactly at the natural width by construction.
- **The histogram row "90–110% = well set" (81 lines) is also partly an artifact:** of those,
  **27 are trivial units of non-justified styles**, and only **54** are genuinely well-set
  justified lines.
- **Consequence for Task 8:** the denominator must be taken **only over justified paragraphs**
  (`LEFT_JUSTIFIED`, `RIGHT_JUSTIFIED`, `CENTER_JUSTIFIED`, `FULLY_JUSTIFIED`). Non-justified
  styles must not land in either "clean" or "out of range" — the notion of a word-spacing
  threshold is undefined for them.

### Distribution

Distribution of ratios (all 399 lines, including the dilution — for comparability with the
first round):

| Ratio | Lines | Share |
|---|---|---|
| < 60% | 6 | 1.5% |
| 60–80% | 22 | 5.5% |
| 80–90% | 29 | 7.3% |
| 90–110% | 81 (27 of them trivial) | 20.3% |
| 110–133% | 69 | 17.3% |
| 133–160% | 63 | 15.8% |
| **> 160%** | **129** | **32.3%** |

Percentiles of the ratio: p05 = 0.767, p25 = 1.000, **p50 = 1.305**, p75 = 1.786, p95 = 2.824.

**The maximum across all 399 lines is 4.971 (497%)**: paragraph 99, line 1, median space
13.148 pt, 6 spaces. The first round reported "up to 411%" here — that was the maximum of an
**8-line sample** drawn from paragraphs 2–10, not the maximum over all 129 lines above 160%.
Fixed.

### Mechanism check (not coverage)

To make sure the large ratios were not a measurement artifact, a **point sample of 8 lines**
was taken from the "Основний текст F" style with ratio >1.6 and its line width was checked
against the frame width. This checks the **mechanism**, not coverage: 8 of 399 lines do not
validate the distribution, they only show that the large ratios correspond to lines genuinely
justified to full measure, not to an artifact.

| Paragraph/line | Chars | Spaces | Median space, pt | Ratio | Line width / frame width, pt |
|---|---|---|---|---|---|
| 6 / 1 | 60 | 10 | 10.865 | **4.11** | 368.504 / 368.504 |
| 6 / 0 | 59 | 9 | 8.562 | 3.24 | 352.517 / 368.504 |
| 5 / 0 | 66 | 8 | 5.348 | 2.02 | 352.517 / 368.504 |
| 6 / 4 | 69 | 9 | 4.782 | 1.81 | 368.504 / 368.504 |
| 4 / 0 | 69 | 11 | 4.412 | 1.67 | 352.517 / 368.504 |

The lines are indeed justified to full measure, and the stretching is genuine: in line 6/1,
ten spaces at 10.87 pt each amount to 108.7 pt of "air" over a 368.5 pt column, nearly 30% of
the line. That line's text ends with `\n` — a forced line break. This is a known InDesign
trap: a forced break inside a justified paragraph **stretches the preceding line to the full
measure**. So some of these findings are not "normal justification variance" but genuine
typesetting defects that the tool should indeed catch.

### Conclusion

- The thresholds **carry signal but are unfit as a binary filter**: 59.14% of lines flagged as
  justified is not a report, it is noise the user would drown in.
- The signal is graded: 32.3% of lines exceed 160%, and these contain the roughest cases
  (maximum 497%). Task 8 should **rank by severity of deviation** and keep the 80/133 style
  bounds as reference information in the finding's explanation, not as a selection criterion.
- **Caveat:** 59.14% is a property of **this** document, not a constant. The book, it seems,
  was never run through a typesetting proofread — which is precisely why this tool was
  commissioned. Task 8's threshold should not be hard-coded to a number fitted to one
  document.

---

## Side question: hypothesis H1 about 3.21994 pt

Phase 2 measured a synthetic width for line/paragraph-end control characters —
3.21994018554688 pt — and **assumed**, without verifying, that it equals the space width for
that font and size.

**The hypothesis is confirmed.** Direct comparison across four styles:

| Style@size | Synthetic `\r` width, pt | Calibrated space width, pt | Match |
|---|---|---|---|
| «Питання в інтерв'ю»@14 | 3.21994018554688 | 3.21994018554688 | **exact, all 15 digits** |
| «Основний текст L»@11.5 | 2.64492797851562 | 2.64494323730469 | discrepancy 1.5e-5 pt = 1 ULP |
| «Основний текст F»@11.5 | 2.64494323730469 | 2.64494323730469 | **exact** |
| «Підпункти в основному тексті -1»@11.5 | 2.64494323730469 | 2.64494323730469 | **exact** |

The 1.5e-5 pt discrepancy in the second row is exactly 1/65536, i.e. one step of InDesign's
fixed-point representation, not some other number. This also reveals where Phase 2 got exactly
3.21994: this document opens with a paragraph in the "Питання в інтерв'ю" style at 14 pt, and
that style's space width is exactly 3.21994018554688 pt.

### An error in the brief's own formula

The main probe returned `controlCharWidth = 6.73382568359375` — and this number is **not**
the width of the control character. The formula in the brief:

```javascript
var lastCh = firstPara.characters[firstPara.characters.length - 1];   /* this is "\r" */
var prevCh = firstPara.characters[firstPara.characters.length - 2];   /* this is the last letter */
out.controlCharWidth = lastCh.horizontalOffset - prevCh.horizontalOffset;
```

The difference `horizontalOffset(\r) − horizontalOffset(last letter)` is the width of the
**last letter**, because `horizontalOffset` gives the character's START position. The width of
`\r` itself is given by a different difference:
`line.endHorizontalOffset − horizontalOffset(\r)`, which is exactly what Phase 2 measured.

Proof that this is so, not interpretation: an auxiliary probe for the "Питання в інтерв'ю"@14
style returned `lastGlyphWidth = 6.73382568359375` — the same number to the last digit —
alongside `controlCharSyntheticWidth = 3.21994018554688`. The `scripts/probe-calibration.jsx`
probe was left with the brief's formula unchanged (transcribed verbatim, as Task 1 required),
so its `out.controlCharWidth` field **must be considered mislabeled** and cannot be relied
upon.

---

## Task 6 (B5.1): what was measured while implementing `composition_measure`

Measured on the same document, the same way (read-only, via `run_script` and via the
`composition_measure` handler itself).

### `line.index` compared against `frame.lines` — the baseline fallback is not needed

The plan called for: if `line.index` cannot be compared against `frame.lines`, replace the
`isFirstInFrame`/`isLastInFrame` flags with a `baseline` comparison. **The replacement was not
needed.** On a full document run (5,193 lines), `isFirstInFrame` = `isLastInFrame` = **620**,
i.e. exactly one first and one last line for each of the 620 non-empty frames —
self-consistent. `frame.lines[0].index` and `frame.lines[len-1].index` are indexed within the
story, same as `line.index`, so the comparison is valid.

### `character.contents` returns an **Enumerator**, not a string, for ordinary typography

This is the task's main surprise. The brief's rule "non-string `contents` → control character"
assumed that only control characters are non-string. **The assumption is false.** A sweep over
the largest story (33,532 characters, 561 lines):

| What `contents` returns | Count | Is it actually a control character? |
|---|---|---|
| `"\r"` / `"\n"` (string) | 161 | yes |
| `FORCED_LINE_BREAK` (Enumerator) | 44 | yes |
| `EM_DASH` (Enumerator) | 95 | **no — a printed dash** |
| `SINGLE_RIGHT_QUOTE` (Enumerator) | 28 | **no — an apostrophe** |
| `NONBREAKING_SPACE` (Enumerator) | 4 | **no — a space** |
| `ELLIPSIS_CHARACTER` (Enumerator) | 1 | **no — an ellipsis** |
| `DOUBLE_LEFT_QUOTE` / `DOUBLE_RIGHT_QUOTE` (Enumerator) | 1 + 1 | **no — quote marks U+201C/U+201D** |
| **Total misclassified** | **335 of 33,532 (1.00%)** | of which **130 are printed characters** |

Consequences to account for in Tasks 7–11:

- An apostrophe in Ukrainian text (`Пам'ятаю`) comes back as `SINGLE_RIGHT_QUOTE` and, under
  the brief's rule, becomes `ch: null` — and in the `text` field, **a space**. So `text`
  contains false spaces wherever apostrophes, dashes, and ellipses actually stand.
- `NONBREAKING_SPACE` likewise becomes `ch: null` and is likewise turned into a space in
  `text` — even though the composer stretches a non-breaking space **differently** from an
  ordinary one. A detector that looks for spaces in `chars` via `ch === " "` will miss it; a
  detector that reads `text` will count it as an ordinary space. The discrepancy is silent.
- Literal checks against `"\n"`, U+2028, and U+2029 **never fire once** in this document: a
  forced line break arrives as `FORCED_LINE_BREAK` (Enumerator) and is caught by the "not a
  string" fallback branch rather than its own.
- `endsWithHyphen` fired **2 times across 5,193 lines** on the whole document. InDesign's
  automatic hyphenation is not a text character, so it is entirely absent from
  `line.characters`. For Task 10 this means hyphen breaks cannot be caught via
  `line.characters`.

### Master-spread stories get pulled into the measurement

`doc.stories` includes stories whose frames sit on master spreads, and the handler measures
them right alongside body text. `frame.parentPage.name` for them is **the master page's name**
(`"B"`, `"E"`, `"F"`, `"M"`, `"N"`), not a document page number. So `MeasureResult.pages` on
this document holds **201 unique names for 196 pages**: 196 numbers plus master names.
`doc.stories[0]` is the same running-head service frame Phase 2 found; its content is
`AUTO_PAGE_NUMBER`, `EN_DASH`, `PREVIOUS_PAGE_NUMBER`. `inspect.jsx` already has
`IDMCP.isMasterParent` for this; the measurement layer has no counterpart yet.

### The cost of a full run bumps into the AppleScript timeout

A full document measurement (5,193 lines) succeeds, but **close to the limit**: one run
completed successfully, the next failed with `AppleEvent timed out (-1712)`. This is **not**
the bridge's `timeoutMs` — it is AppleScript's own `do script` timeout (120 s by default),
which `runJsx` does not override. Narrowing to a handful of pages costs **6.5–7.0 s**
regardless of how many pages, because the page filter sits **inside** the line loop: the walk
over every paragraph of every story happens regardless, only the per-character read is saved.
Task 12 should chunk the document into page batches.

### Effective measure — confirmed on real data

`columnWidth` on the body text is **368.503937007874 pt**, matching the frame width measured
in H3, 368.504 pt, to the last digit. Meanwhile, across the whole document there are **24
distinct** `columnWidth` values, and the style "Відбивка в тексті"@11.5 gives **336.5291 pt**
against 368.5039 pt for the neighboring "Основний текст F"@11.5 — a difference of exactly
31.9748 pt of paragraph indent. So subtracting `leftIndent`/`rightIndent` is not a theoretical
correction: in this document it is nonzero and noticeable.

### Distribution of `justification` across the whole document

| `justification` | Lines |
|---|---|
| `LEFT_JUSTIFIED` | 2,580 |
| `LEFT_ALIGN` | 2,182 |
| `CENTER_ALIGN` | 379 |
| `RIGHT_ALIGN` | 47 |
| `RIGHT_JUSTIFIED` | 5 |

**50.2% of the document's lines are non-justified** (2,182 + 379 + 47 = 2,608 of 5,193). This
backs the fix that added the `justification` field to `LineMeasure`: without it, more than
half the corpus would sit in detector denominators with no way to be flagged.

> **Correction (Task 9 review).** This section previously read "42%" — that is `LEFT_ALIGN`
> alone (2,182 / 5,193 = 42.0%), not all non-justified lines. The error contradicted the
> table above and erred in the direction that WEAKENS the conclusion, which is why it survived
> two rounds. The number propagated from here into `src/composition/types.ts`,
> `measurable.ts`, `detect-spacing.ts`, and `detect-lines.ts`; fixed everywhere.

### Paragraphs split across pages

**32 paragraphs** in the document have lines on more than one page (e.g. `story:4#13` →
pages 16/17). This is exactly why geometry is taken from **that same line's** frame, not from
`para.parentTextFrames[0]`.

### Task 6 fix round: what was re-measured

The review independently reproduced every number above and found something no one else had
seen. Below are only new or **corrected** facts.

#### Rotated frames return lines of ZERO width (the main finding)

**111 of 5,193 lines** sit in frames rotated by ±90°, and for each of them
`line.horizontalOffset === line.endHorizontalOffset`, i.e. `right − left === 0`, every
`chars[i].x` is the same constant, and `geometricBounds` is an axis-aligned bounding box, from
which the effective measure comes out to 45.35 pt instead of the true ~512 pt along the
frame's own axis.

| Measurement | Value |
|---|---|
| Rotated lines | **111** (angle −90: 98, angle +90: 13) |
| Zero-width lines | **111** |
| Intersection of the two sets | **111 — the split is exact** |
| Rotated with nonzero width | **0** |
| Styles | «Колонтитул v1» ×104, «Нумерація сторінок» ×6, «Колонтитул v2» ×1 |

`rotationAngle` and `absoluteRotationAngle` agree on all 651 containers in the document.
The handler now returns `rotated` and `rotationAngle`; measuring rotated text along its own
axis is out of this task's scope — the requirement is only that it not pass itself off as
measurable body text.

#### `isMaster` is correct but insufficient

`IDMCP.isMasterParent` flags **20 of 5,193 lines**. The true population of running heads and
folios is **111**, i.e. **91 of them sit on ordinary document pages**, not on masters. So
`isMaster` catches 18% of the contamination, and `rotated` catches 100%. Both fields now
exist, but `rotated` is the one to rely on.

#### `line.contents` instead of per-character `contents` — both more correct and faster

Checked on all 5,193 lines: `typeof line.contents === "string"` with no exceptions,
`line.contents.length === offsets.length` with no mismatches, `chars[0].x ===
line.horizontalOffset`. Cost — **196 ms versus 12,444 ms** for the per-character pass it
replaces. `text` now carries genuine Unicode; across the whole document:

| Character | Count |
|---|---|
| U+2014 EM DASH | 670 |
| U+00AB / U+00BB « » | 302 / 302 |
| U+2019 apostrophe | 286 |
| U+2013 EN DASH | 205 |
| U+00A0 non-breaking space | 28 |
| U+2026 ellipsis | 14 |
| U+201C / U+201D | 2 / 2 |

**Correction to the table above:** `DOUBLE_LEFT_QUOTE`/`DOUBLE_RIGHT_QUOTE` are U+201C/U+201D
(2 each in the document), not Ukrainian guillemets. The genuine « » come in as plain strings,
302 each, and were never Enumerators.

At the same time, the substitution of a space for a control character in `text` was removed:
until now, `FORCED_LINE_BREAK` (44 in one story) was indistinguishable from an actual space —
the same flaw as the non-breaking space had. Now `text` carries the genuine character, and
"not a glyph" is signaled exclusively by `ch: null`.

#### C0 characters that neither the brief nor the review anticipated

Found in the fixture while writing tests: **the table anchor is U+0016, the footnote marker is
U+0004**. Both passed the "not \r, not \n, not U+2028/U+2029" check as ordinary glyphs. A line
consisting of nothing but a table anchor has **zero width at full column width** — exactly the
same trap as the rotated frames, just from the other side. `isPrintableChar` now filters out
**the whole C0 range** (`charCodeAt < 32`), not a list of four characters. There are no such
lines in the book itself; there are two in the fixture.

#### Hyphenation: the "letter + letter" rule instead of "word runs past the edge"

InDesign's automatic hyphenation is not a text character, so the brief's rule produced only
**2 hits across 5,193 lines**. The working rule is: a line's last character and the next
line's first character are both letters; a literal hyphen and a soft hyphen were still merged
in. Measured by the review: 80 hits in **322 ms** versus 81 hits in **4,906 ms** for the
"word runs past the line edge" variant, where the sole discrepancy is a false positive on the
last one, for a line ending in "…риба/яйця/бобові/" (InDesign treats this as a single `Word`).
Across the whole document, the new rule gives **103 hyphenations**.

ExtendScript recognizes case for both Latin and Cyrillic, so `ch.toUpperCase() !==
ch.toLowerCase()` is a valid "is it a letter" check: for 'а'/'А' the values differ, for a
digit, a hyphen, or an apostrophe they are the same.

#### `firstLineIndent` applies to the first line of EVERY paragraph

Not only single-line ones, as previously recorded. Lines with a nonzero `firstLineIndent`
number **907 of 5,193 (17.5%)**, while single-line paragraphs number only 415. The value
15.99 pt is 4.3% of the base measure and **six times larger than the recommended ε**.
**265 of these indents are negative** (hanging indent), which is why the aggregate impact on ε
looked small. The rule is now: `if (lineInParagraph === 0) columnWidth -= firstLineIndent;`.

#### Overshoot of the measure: 13 genuine, the rest noise below ULP

**Fix:** the previous round's claim of "0 lines wider than `columnWidth`" was wrong — it was
measured on three pages, not the whole document. Across the whole document, among 4,598
measurable lines:

| Overshoot of the measure | Lines |
|---|---|
| ≤ 1e-6 pt | 426 |
| 1e-6 … 0.01 pt | 256 |
| 0.01 … 0.25 pt | 0 |
| **> 0.25 pt (genuine)** | **13** |

1 ULP of InDesign's fixed-point representation is 1.5e-5 pt, so the first two groups (682
lines) are representation noise, not overshoot. The genuine ones number **13**, maximum
**4.599 pt**: «Повідомлення від мам 1» ×9, «Основний текст L» ×2, «Основний текст F» ×2. (The
review attributed all 13 to the "Повідомлення від мам 1" style; the measurement shows nine of
them genuinely are that style, and four are body text. The review confirmed this discrepancy.)

**Cause identified (round 2): it is a trailing space.** All **13 of 13** genuine overshoots
are lines that end in a space, and the overshoot equals exactly that space's width, which
legitimately hangs past the measure (normal InDesign wrapping behavior). Of the 682
below-threshold cases, **670** end in a space.

This closes a question left open since H3: **paragraph #130 is no longer an unexplained
case.** Its line 2 (`story:168`) has an overshoot of 0.2505 pt and ends in `"еслити межі. "` —
a period, a space, then the end of the paragraph. No composition anomaly: a space hangs past
the measure.

**Consequence for detectors:** line width must be compared against the measure at the right
edge of **the last non-space glyph**, not at `right`. A naive comparison gives up to 4.6 pt of
false overshoot.

#### Filtering at the story level: 30× and nothing lost

The page filter was raised from inside the line loop to the story level. Equivalence check: a
narrowed call on pages 22–23 gave **47 lines**, and those same pages from the full run gave
**the same 47 lines, key for key** (`containerId|paragraph|line|text`), nothing lost. The cost
of the narrowed call dropped from ~5.7 s to **542 ms**.

**Deliberate consequence:** for a story whose frames sit on a master spread, `parentPage` is
the master page, so when `pages` is specified, such stories are filtered out entirely.

**FIX (round 2).** A previous version of this section claimed that page-narrowing removes all
running heads, "because all 111 contaminated lines are of that kind." **This is wrong** — and
it contradicted the neighboring section on `isMaster` in this very document. Measured:

| Where the 111 rotated lines sit | Count |
|---|---|
| On master spreads (filtered out by narrowing) | **20** |
| On ORDINARY document pages (filtered by nothing) | **91** |

Pages with "ordinary" rotated lines: 7, 9, 11, 15, 17, 19, 23, 25, 27, 29, 31, 33 … — 91 pages
total. Verified directly: a query for pages 22–23 returns **one** rotated line, exactly as the
full run does. So **page-narrowing does NOT sanitize the sample**; the only reliable
contamination filter is the `rotated` flag.

#### `endHorizontalOffset` does NOT include the hyphen glyph (round 2)

The right edge InDesign returns for a line stops at the last character of the TEXT, while the
hyphen the composer draws sits to the right of it. Measured on every justified line in the
document:

| Group | Lines | Shortfall from `columnWidth`, pt |
|---|---|---|
| Justified **with a hyphen** | 100 | min 3.9099 · median **3.9100** · max 3.9100 |
| Justified **without a hyphen** | 1,403 | median **0.0000**, within ±0.001 |

All 100 are at 11.5 pt; each of them has a shortfall of ≈3.91 pt, spread 0.0001 pt. A direct
check by a separate probe: `line.endHorizontalOffset − last character.endHorizontalOffset ===
0` on every hyphenated line checked, i.e. the hyphen is entirely absent from the text
coordinates.

**Consequence:** anyone comparing `right` against `columnWidth` without accounting for
`endsWithHyphen` will read **6.7% of justified lines** (100 of 1,503) as "loose" by about
3.9 pt — exactly the order of error Task 8 is meant to catch. This is already resolvable now,
since `endsWithHyphen` exists; the field is documented in `LineMeasure.right`.

#### A line fit for measurement: a two-condition rule (round 2)

Besides rotated frames, there is a second class of lines that cannot go into any denominator,
and NO flag marks it: **empty paragraphs**.

| Class | Lines | Share | What flags it |
|---|---|---|---|
| Rotated frames | 111 | 2.1% | `rotated` |
| **No glyphs at all** (empty paragraphs) | **484** | **9.3%** | nothing — a rule only |
| Total unfit | **595** | **11.5%** | |

Empty lines have the **full** `columnWidth` (389 of 484 — over 100 pt) alongside their own
width of 2.3–7.6 pt, and none of them is flagged by either `rotated` or `isMaster`. So to a
detector they look like body-text lines that are "terribly under-filled."

**The rule, singular and mandatory** (recorded in the `LineMeasure` doc comment):

```
a line is fit for measurement  ⟺  !rotated && chars.some(c => c.ch !== null)
```

#### The AppleScript timeout is now derived from `timeoutMs`

`do script` without an explicit `with timeout` is capped at the default 120 s regardless of
the bridge's `timeoutMs` — exactly why the full measurement failed with
`AppleEvent timed out (-1712)`. The bridge now emits `with timeout of N seconds`, and the
osascript process is killed 5 s later, so the more precise -1712 has time to arrive. Full
document run: **116,533 ms, 5,193 lines** — succeeded. `classifyOsascriptFailure` now
recognizes -1712 as `busy` (previously it arrived with `timedOut === false` and fell through
to `unknown` with a raw stderr dump).

### The document remained unchanged

| Check | Before | After |
|---|---|---|
| `doc.modified` | `false` | `false` |
| `doc.saved` | `true` | `true` |
| Active document | `Book-A 260804-0141.indd` | the same |
| Edit menu items 1–3 | — | `Undo`, `Redo`, `missing value` |

The first Edit menu item is plain `Undo` with no step name, i.e. the undo history is empty.
None of this task's undo names (`Зонд B5.1 …`) appeared in the menu, even though `run_script`
wraps the script in `withUndo` and would leave a trace on any mutation.

---

## Check: did the document remain unchanged

Same procedure as in H1. State **before** any run and **after** all runs of both rounds (main
probe, diagnostics ×2, point-sample breakdown, batching ×4, effective measure ×2):

| Check | Before | After |
|---|---|---|
| Window title | `Book-A 260804-0141.indd @ 75% [GPU Preview]` | **the same** |
| "Unsaved" asterisk | **absent** | **absent** |
| First Edit menu item | `Undo` | `Undo` |
| Edit menu items 1–3 | — | `Undo`, `Redo`, `missing value` |
| `doc.modified` | `false` | `false` |

- The first Edit menu item is plain **`Undo`** with no step name, i.e. the undo history is
  empty and none of the runs left a trace in it. None of our undo names
  (`Зонд H3 (лише читання)`, `…-діагностика`, `…-чому`, `…-пакетування`, `…-міра`) appeared in
  the menu, even though `IDMCP.handlers.run_script` wraps the script in `withUndo` and would
  leave one on any mutation.
- `doc.modified === false` before and after — i.e. the document was not only left unchanged
  but was also in a saved state the whole time. This differs from Phase 2, where both the
  asterisk and `modified === true` were already present before the work started; this time the
  starting state is cleaner, and the check is correspondingly stricter: any mutation would
  immediately produce `modified === true` and the asterisk in the title bar.
- This time InDesign's interface is in English (menu `Edit`, not `Правка`, as in Phase 2) —
  the check command had to be adjusted accordingly. `System Events` does not return a window
  list for the InDesign process (`Invalid index`), so the window title was read via InDesign's
  own AppleScript.

---

## What remains unmeasured

- ~~**Why paragraph #130 overshoots the effective measure by 0.25 pt.**~~ **RESOLVED in Task 6
  round 2** — see the "Overshoot of the measure" section. The line ends in `"еслити межі. "`,
  and it is exactly this trailing space that hangs past the measure; 0.2505 pt is its width.
  There is no composition anomaly, same as the rest of the 12 "overshoots." Item closed.
- **Why the last lines of paragraphs 91 and 116 fill the measure exactly, with their natural
  spaces intact.** A gap of 1.88e-9 pt with a space ratio of 1.000 — the text landed at the
  measure with no tracking adjustment at all. Twice in a row is unlikely to be chance, but the
  cause is not established.
- **The empty band (0; 4.12) pt that ε rests on is backed by a small sample exactly where it
  matters:** of 129 genuine last lines, only 7 lie below 10 pt. A document with tighter setting
  could well produce a genuine last line closer to the measure, narrowing ε's upper bound. This
  is the main reason to express ε in space widths rather than as a constant.
- Total characters/lines for the **whole** document were not counted this time (the probes only
  measure the largest story). The cost extrapolation to the whole document relies on Phase 2's
  numbers (217,493 characters, 5,251 lines) for the 260731 copy — valid by order of magnitude,
  but not a fresh measurement.
- Calibration was measured on only **four** (style, size) pairs from the first 400 paragraphs
  of one story. Heading, epigraph, and caption styles were not sampled; whether the document
  has styles with word-spacing bounds other than the common 80/100/133 remains unchecked
  (Phase 2 left this open, and H3 did not close it).
- The effective measure was verified only on frames with zero insets and one column — the
  formula for multi-column frames and nonzero insets is **derived but not verified by
  measurement**, since this story has no such frames.
- The 59.14% figure was computed on 372 justified lines from the first 400 paragraphs, not on
  the whole document.
