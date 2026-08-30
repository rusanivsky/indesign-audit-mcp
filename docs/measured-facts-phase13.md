# Measured Facts — Phase 13 (block `D`: geometry, frames, text wrap, images)

Probe `H13`, four passes, **all read-only**. The book —
`Book 260811-1645.indd`, 196 pages, 99 spreads, InDesign
**21.5.1.73**, 2026-08-15.

**Read-only status proven by the flag on a FRESHLY OPENED document:**
`modified = false` before and `false` after each of the four passes. This is
a stronger form of proof than in Phase 5 (there the flag was already `true`
before the start and proved nothing): the book was opened by this very probe,
so the baseline state is known.

Scripts: `scripts/probe-h13-recon.{jsx,mjs}` (pass 1),
`probe-h13-geom.{jsx,mjs}` (2), `probe-h13-coords.jsx` (3),
`probe-h13-model.{jsx,mjs}` (4). The final-review fix wave (2026-08-15)
added two more: `probe-h13-margins.jsx` (semantics of
`marginPreferences.left/right` — basis for C1) and
`probe-h13-rotated-bounds.jsx` (bounding box of a rotated frame — basis for
I3).

**The path to the book in memory was stale.** The folder is called
`Book` (seven "а"s), and the subfolder `03 Файли проєкту` (plural).
The previously recorded `Book-A/03 Файл проєкту` does not exist.

---

## Questions 1–2. Traversal instrument: 36% of the document is invisible to the obvious instrument

Four instruments on the same book give four different numbers:

| Instrument | Sum across 196 pages |
|---|---|
| `page.textFrames` | 573 |
| `page.pageItems` | 618 |
| `page.allPageItems` | **965** |
| `page.masterPageItems` | 9665 (the same object on every master-based page) |
| `doc.pageItems.everyItem()` | 780 |

**The instruments diverge on 137 of 196 pages.**

The headline number: `doc.pageItems.everyItem()` gives **780**, of which 618
are top-level document items and 162 are top-level master items. The
per-page `allPageItems` gives **965** document items. The difference of
**347 elements (36%)** is the contents of groups and anchored objects that
the document-level traversal doesn't see **at all**.

**The document-level traversal sees ZERO anchored objects**
(`parentKinds`: only `Spread` 618 and `MasterSpread` 162), whereas there are
**303** of them in the book. This is the same class of error that killed
Phase 6 (`page.textFrames` can't see anchored objects) and Phase 10
(`page.textFrames` can't see un-overridden master items). Third time in a
row — and a different instrument each time.

**The instrument for this phase is the per-page `page.allPageItems`.** Its
cost is measured: **744 ms** for a full traversal of 196 pages while reading
twelve properties per element. The page traversal itself is 1 ms,
`doc.pageItems.everyItem()` is 39 ms.

**There are three hidden layers** (`Layer 8`, `Нумерація`, `Шар 4`), and on
all three `layer.pageItems.length = 0` — meaning the 29 dormant folio
numbers that Phase 7 measured on the `Нумерація` layer are NO LONGER there.
This measurement **neither proved nor disproved** `allPageItems`'s blindness
to hidden layers: there's nothing to check it against. `layer.pageItems`
only counts the top level, so an element inside a group on a hidden layer
remains unverified.

---

## Questions 3, 10. Two coordinate systems in one API

**This is the phase's main trap, and the first model broke on it.**

`page.bounds` returns coordinates in the **SPREAD's** space: verso —
`[0, 0, 623.62, 538.58]`, recto — `[0, 538.58, 623.62, 1077.17]`.

An element's `geometricBounds` returns coordinates in **its OWN page's**
space. Measured directly: the first element on p. 9 (recto) has
`x 97.09…125.43`, while `page.bounds` for that same page says
`x 538.58…1077.17`.

The first classification mixed the two spaces and produced nonsense —
**545 of 546 recto elements "outside the type area."** The nonsense was in
the instrument, not the book (Phase 7's rule: a discrepancy that
contradicts the obvious is grounds to suspect the instrument). On verso the
error is invisible entirely, because there the page's origin coincides with
the spread's origin: **checking verso alone would have said "everything's
fine" and missed the error completely**.

The type area must be built **from the page's own (0, 0)**, not from
`page.bounds`.

### Units — the same trap that felled C2 in Phase 9

`geometricBounds` returns numbers **in the document ruler's units**. For
this book those units are **millimeters**
(`viewPreferences.horizontalMeasurementUnits = MILLIMETERS`), so the same
element gives `x = 34.25` without forcing units, and `x = 97.09` under
`app.scriptPreferences.measurementUnit = POINTS`. Both numbers were measured
on the same element within this session.

This is exactly the mechanism that broke C2 in Phase 9 (fixture in picas,
constants in points). Now it has been measured **a second time and
independently** — so it isn't a one-off case, but a property of the API.

### `resolve()` — an instrument independent of both units and the coordinate origin

`resolve()` is called with a **bare** enumerator. Both obvious forms
(`[AnchorPoint.TOP_LEFT_ANCHOR]` and `[[AnchorPoint.TOP_LEFT_ANCHOR],
CoordinateSpaces.X]`) **throw** — this is measured, not guessed:

```
it.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.PAGE_COORDINATES)      // works
it.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)    // works
it.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.PASTEBOARD_COORDINATES)// works
```

The same element in three spaces: `PAGE` → `97.0866`, `SPREAD` →
`−260.7599`, `PASTEBOARD` → `3021.7597`. **The numbers are in POINTS even
when the document ruler is in millimeters** — i.e. `resolve()` depends on
neither the units nor where the user dragged the ruler zero point.

**Unresolved, and the spec must not lean on this without a follow-up
measurement:** exactly what the second number of the pair means. For the
same element `resolve(...PAGE)` gave `(97.0866, 79.3975)`, while
`geometricBounds` under POINTS gave `y = 51.05`. The first number of the
pair matches `x` exactly; the second does **not** match `y`. Until it is
established whether this is a different origin or a different pair order,
`resolve()` is fit as an instrument **for x only**. The follow-up
measurement is the first thing the measurement task must do.

`viewPreferences.rulerOrigin = PAGE_ORIGIN`, `doc.zeroPoint = [0, 0]` —
i.e. on this book the settings are "convenient." **That is exactly why it's
dangerous:** `geometricBounds` will silently give different numbers in a
document where the ruler zero has been moved, and no check will notice.

---

## Questions 11, 17. "Outside the type area" is NOT a sign of a defect

On the corrected model (type area from (0,0), mirrored margins: on verso
`left`/`right` swap):

| | elements |
|---|---|
| classified in total | 965 |
| **inside the type area** | **300 (31%)** |
| outside the type area by ≤ 0.01 pt | 1 |
| outside by ≤ 0.1 pt | 43 |
| outside by ≤ 1 pt | 2 |
| outside by ≤ 3 pt | 0 |
| outside by ≤ 10 pt | 17 |
| **outside by > 10 pt** | **602 (62%)** |

**A conclusion that kills the most obvious detector of the phase before it's
even written: 62% of the book's elements lie outside the type area ON
PURPOSE.** The interview question number sits in the margin to the left of
the column — this is a canonical rule of this edition. The folio number sits
in the bottom margin. Table-of-contents numbers, rules, full-bleed panels —
all lie outside the type area by design. A detector saying "element outside
the type area" would report 602 findings, of which zero are defects.

**What remains a signal is a NEAR MISS, not a gross overshoot.** The
breakdown shows a gap: 46 elements miss the type-area boundary by less than
1 pt (44 of those by less than 0.1 pt), and after that it's empty up to
10 pt. An element that missed by 0.05 pt was almost certainly meant to
align exactly; one that ended up 80 pt off is intentional. **The signal has
the shape of "nearly aligned," not "out of bounds."**

**Only 14 elements** go beyond the page itself (10 by ≤ 10 pt, 4 by >
10 pt) — unlike 602, this is already a workable number. A measured example
of a deliberate overshoot: p. 96, `Rectangle`
`[−8.50, −8.50, 632.13, 538.58]` — exactly an 8.5 pt bleed on three sides,
matching `documentBleed*Offset = 8.50393700787402`. So a **bleed must be
checked against the document's declared bleed value**, and then the
full-bleed panel stops being a finding.

Margins are identical on all 196 pages: one signature —
`51.02 | 79.37 | 60.58 | 90.71 | 1 column | 12 pt`. Bleed:
top/bottom/outside 8.5 pt, **inside 0**
(`documentBleedInsideOrLeftOffset = 0`).

**`page.bounds` alone is noisy:** there are 17 different signatures where
there should be two (verso and recto). Discrepancies are `−5.68e-14`,
`3.64e-12`, `−7.28e-12` — i.e. double-precision floating-point error.
**Comparing geometry without an epsilon is impossible in principle**, and
this is a property of InDesign, not of this book.

---

## Question 12. Touching is not a signal: 118 of 196 pages have it

Pairwise intersection within a page: **692 elements (71.7%)** intersect
with something, **421 (43.6%)** have a TOUCH (intersection exactly zero
along one axis, epsilon 0.001), and such touches occur on **118 pages**.

**A consequence for the design, and an unpleasant one:** the seven pages of
touching found by Phase 8 (`101, 109, 153, 167, 171, 185, 195` — a 150 pt
quote mark touching a folio number) are **geometrically indistinguishable
from the other 111 pages**. Touching in a grid layout is normal: adjacent
frames share a boundary exactly. A detector saying "elements touch" would
report 421 findings, of which seven are meaningful.

So the family must not report touching as such. What's meaningful is a
**touch between elements belonging to DIFFERENT roles** (decorative frame
vs. utility frame), and that requires a role, which geometry does not know.
A question for the spec, not an answer.

---

## Questions 4, 9. Text wrap: ZERO material in the book

`textWrapPreferences.textWrapMode` was read on **all 965 elements** with the
correct instrument: **`NONE` × 965**, no exception, no throw.

This is measured, not assumed — and that's exactly why the wording is
cautious: **the `wrap` family has nothing to be verified against in this
book**. This is exactly the situation Phase 6 had with `runningHead`
("there's no material"), and there the conclusion later turned out to be
wrong — but wrong because of the **instrument** (`page.textFrames`), not the
fact. Here the instrument has already been fixed and covers 100% of the
population, so the zero is genuine.

**Decision for the spec:** the `wrap` family is either deferred, or is
written against a fixture and never proven on the book at all — and this
must be said out loud, not hidden behind green tests.

---

## Question 5. Images: six, and two of them break the obvious code

`doc.allGraphics` — **6** objects (the layout log said "4 PSD"; the two
`logo.ai` weren't counted).

| Type | File | Page | `effectivePpi` | `actualPpi` | `space` | scale |
|---|---|---|---|---|---|---|
| `Image` | `Mother_1.psd` | 2 | 451×451 | 300×300 | CMYK | 66.47% |
| `Image` | `Mother_2.psd` | 20 | 409×409 | 300×300 | CMYK | 73.32% |
| `Image` | `Mother_3.psd` | 96 | 414×414 | 300×300 | CMYK | 72.54% |
| `Image` | `Mother_4.psd` | 128 | 451×451 | 300×300 | CMYK | 66.47% |
| `PDF` | `logo.ai` | 3 | **throws** | **throws** | **throws** | 22.92% |
| `PDF` | `logo.ai` | 196 | **throws** | **throws** | **throws** | 20.59% |

**A measured trap:** the `PDF` type (and `.ai` is imported precisely as
this type) has no `effectivePpi`, `actualPpi`, `space` properties — access
throws `Object does not support the property or method`. Code that reads
`effectivePpi` in a loop over `allGraphics` **will crash on every book with
a vector logo**, which is almost every book. Branching by type is required,
and "a vector has no ppi" is not a defect but a property.

All six links have `status = NORMAL`, `needed = true`. So the "broken link"
and "modified link" branches **this book does not prove at all** — the same
way Phase 12 could not prove pre-reform spellings. Only a fixture can
provide that proof.

Effective resolution of 409–451 ppi against an actual 300 is margin, not a
defect. This confirms the layout log's record and simultaneously shows that
`ADBE_ImageResolution`, disabled in the `[Basic]` profile, wouldn't have
found anything here either.

---

## Question 13. 303 anchored objects are THREE different populations

Breakdown by applied paragraph style:

| Style | Count | Size (pt) | What it is |
|---|---|---|---|
| `Нумерація питань` | **185** | 28.3×48 (106), 34×48 (53), 34×48.1 (24), 28.3×48.1 (2) | interview question numbers |
| `Зміст Номер сторінки` | **35** | 28.3×20 | table-of-contents numbers (cross-references) |
| *(throws — not text)* | **82** | 340.2×**0** | `GraphicLine`, inter-block rules |
| *(not text)* | 1 | — | — |

**185 matches the layout log exactly**, and 35 matches Phase 6's
measurement ("35 numbers in the table of contents, 35 cross-references").
The 28.3 and 34 pt widths are the 10 mm and 12 mm from the canonical rule
("10 mm for single-digit numbers, 12 mm for two-digit ones"). So the
measurement agrees with three independent sources.

**The 82 rules have a height of exactly 0.** Any geometry check that
divides by height, or that treats a zero bounding box as degenerate, will
break exactly here. `GraphicLine` has no `.paragraphs`, so accessing the
style throws — this measurement handled it, and the tool must handle it too.

**A consequence for the `anchored` family:** three populations are governed
by three different rules, and there is no shared "anchoring rule" between
them. `check-question-numbers.jsx` cannot be generalized verbatim — its
rule ("right edge of the frame = left edge of the column") applies to ONLY
185 of the 303.

---

## Question 16. 91 rotated elements are exactly the folio numbers

**91 `TextFrame`s, all with `rotationAngle = −90`**, no others are rotated.
91 is exactly the number of folio-number frames measured by Phase 6.

For a rotated frame, `geometricBounds` returns an axis-aligned bounding
box, not the frame itself — `composition.jsx` already contains this caveat
for its own purposes. So **9.4% of the book's population has geometry from
which alignment cannot be judged**, and this is not an edge case but an
entire family of objects.

---

## Question 15. The Phase 7 chain is ALREADY APPLIED to the working book

The entry point (`docs/ПРОДОВЖИТИ-ТУТ.md`, section "Nearest by value")
treats the decision "whether to apply `pagination_apply` to the working
book" as open. **The measurement says the `create-helper-thread` operation
has already been performed:**

- the `_folio-helper` layer exists, `visible = true`, `printable = false` —
  exactly as Phase 7 creates it;
- it has **196 frames**, i.e. one per page (§4.2 of Phase 7 requires a
  frame on EVERY page, not just where a folio number exists);
- all 196 sit in a **single history chain** (`id 87108`) — the chain is
  unbroken, with no gaps or splits.

This is not a conclusion about whether the second operation
(`replace-literals`) has been performed — this probe did not measure that.

**Full list of the book's layers** (important, since three are hidden):

| Layer | `visible` | `printable` | `locked` |
|---|---|---|---|
| `Layer 8` | **no** | yes | no |
| `Шар 7` | yes | yes | no |
| `Червоні крапки чеклисту` | yes | yes | no |
| `Нумерація в сторінках` | yes | yes | no |
| `Нумерація` | **no** | yes | no |
| `Шар 4` | **no** | yes | no |
| `Шар 6` | yes | yes | no |
| `_folio-helper` | yes | **no** | no |
| `Шар 1` | yes | yes | no |
| `BG` | yes | yes | **yes** |

---

## Questions 7, 8. Book population with the correct instrument

965 elements on document pages:

| Type | Count |
|---|---|
| `TextFrame` | 832 |
| `GraphicLine` | 82 |
| `Rectangle` | 24 |
| `Group` | 19 |
| `Image` | 4 |
| `PDF` | 2 |
| `Polygon` | 2 |

Parents: `Spread` 618, `Character` **303** (anchored), `Group` 38,
`Rectangle` 6 (contents of graphic frames).

Other measurements: `locked` — 1 element; the `BG` layer is fully locked;
elements on non-printable layers — 196 (all `_folio-helper`); elements on
hidden layers — 0.

---

## What this means for the spec (summary)

1. **Instrument — `page.allPageItems`**, per page, 744 ms. Not
   `doc.pageItems`, not `page.textFrames`, not `page.pageItems`.
2. **Units must be forced to points**, otherwise the numbers are this
   book's millimeters. The second independent appearance of the trap that
   cost Phase 9 an entire debt item.
3. **The type area is built from the page's own (0,0)**, margins mirrored
   on verso. `page.bounds` is a different space, must not be mixed in.
4. **An epsilon is mandatory** — `page.bounds` is noisy at 1e-12 by itself.
5. **"Outside the type area" is not a defect** (62% of the book). The
   signal is a near miss (< 1 pt), and the breakdown shows a natural gap
   for it.
6. **"Touching" is not a defect** (118 of 196 pages).
7. **The `wrap` family has no material** — zero across 965 elements.
8. **`PDF`/`.ai` throws on `effectivePpi`** — branching by type is
   mandatory.
9. **Anchored objects are three populations, not one**, and 82 of them have
   zero height.
10. **91 rotated frames** — the geometry is axis-aligned, alignment cannot
    be judged from it.
11. **The "broken link," "pre-reform wrap," "defective resolution"
    branches cannot be proven by this book** — only a fixture can.

---

## Follow-up measurement of `resolve()` (Task 1)

Probe `scripts/probe-h13-resolve.{jsx,mjs}`, read-only. Same book, same
InDesign session. `modified` was not checked separately — the probe only
reads `geometricBounds` and calls `resolve()`, no assignment to any
document or element property. Units forced to points (as in the rest of the
phase), restored in `finally`. `doc.zeroPoint = [0, 0]`,
`rulerOrigin = PAGE_ORIGIN` — the same "convenient" setting as in the
previous passes.

The question being resolved: does `resolve(TOP_LEFT_ANCHOR,
PAGE_COORDINATES)` give the same `[x, y]` pair for the same element as
`geometricBounds` under POINTS. Checked on the first three elements of
`page.allPageItems` on each of four pages (`8`, `9`, `96`, `97`) — 12 rows,
no exceptions (every `try` around `resolve()` passed with no `catch`, the
`resolveError` field is empty on every row).

### Table of all 12 rows

`dx = geom.x − resolveP.x`, `dy = geom.y − resolveP.y`. The right two
columns are the same difference in millimeters (1 mm = 2.8346456692913 pt),
to show whether the difference is a round number.

| # | page | side | type | geom.x | geom.y | resolveP.x | resolveP.y | dx (pt) | dy (pt) | dx (mm) | dy (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 8 | LEFT_HAND | TextFrame | 136.7717 | 67.0527 | 80.0787 | 95.3991 | 56.6929 | −28.3465 | **20.000** | **−10.000** |
| 1 | 8 | LEFT_HAND | TextFrame | 413.1496 | 88.9033 | −276.3780 | −61.8507 | 689.5276 | 150.7540 | 243.250 | 53.183 |
| 2 | 8 | LEFT_HAND | TextFrame | 413.1496 | 120.9065 | −276.3780 | −93.8538 | 689.5276 | 214.7603 | 243.250 | 75.763 |
| 3 | 9 | RIGHT_HAND | TextFrame | 97.0866 | 51.0511 | 97.0866 | 79.3975 | **0.000** | −28.3465 | **0.000** | **−10.000** |
| 4 | 9 | RIGHT_HAND | TextFrame | 125.4331 | 51.0511 | 125.4331 | 79.3975 | **0.000** | −28.3465 | **0.000** | **−10.000** |
| 5 | 9 | RIGHT_HAND | TextFrame | 401.8110 | 136.9081 | −276.3780 | −125.8570 | 678.1890 | 262.7651 | 239.250 | 92.698 |
| 6 | 96 | LEFT_HAND | Rectangle | −8.5039 | −8.5039 | −8.5039 | −8.5039 | **0.000** | **0.000** | **0.000** | **0.000** |
| 7 | 96 | LEFT_HAND | Image | −61.4001 | −60.4584 | −61.4001 | −60.4584 | **0.000** | **0.000** | **0.000** | **0.000** |
| 8 | 96 | LEFT_HAND | Rectangle | −8.5039 | −8.5039 | −8.5039 | −8.5039 | **0.000** | **0.000** | **0.000** | **0.000** |
| 9 | 97 | RIGHT_HAND | Rectangle | 0.0000 | 51.0236 | −56.6929 | 79.3701 | 56.6929 | −28.3465 | **20.000** | **−10.000** |
| 10 | 97 | RIGHT_HAND | TextFrame | 125.4331 | 99.0283 | 68.7402 | 127.3748 | 56.6929 | −28.3465 | **20.000** | **−10.000** |
| 11 | 97 | RIGHT_HAND | TextFrame | 0.0000 | 0.0000 | −56.6929 | 28.3465 | 56.6929 | −28.3465 | **20.000** | **−10.000** |

Rows 1, 2, 5 are the previously measured rotated anchored question-number
frames (`rotationAngle = −90`, size around 20×28.3 pt, pages 8 and 9;
matches "Question 16" above). For THESE, `geometricBounds` is already an
axis-aligned bounding box (see above), so the discrepancy with `resolve()`
is expected and separate from the question being resolved here.

### Checked against three hypotheses — across ALL rows

- **Hypothesis 1** (`[x, y]`, both match `geometricBounds`): matches fully
  only on rows 6, 7, 8 (page 96, `dx = dy = 0`, to within the
  double-precision error `~1e-12` already recorded for `page.bounds`). On
  rows 0, 3, 4, 9, 10, 11 it does **NOT** match. Hypothesis 1 is
  **refuted**.
- **Hypothesis 2** (a constant offset within one side): not confirmed.
  `LEFT_HAND` gives TWO different `dy` values within these same 12 rows:
  `0` (page 96, rows 6–8) and `−10 mm` (page 8, row 0, excluding rotated
  frames). `RIGHT_HAND` likewise gives two different values: `dx = 0`
  (page 9, rows 3–4) and `dx = 20 mm` (page 97, rows 9–11). So the offset
  changes from page to page within the same side — it isn't a per-side
  constant. Hypothesis 2 is **refuted**.
- **Hypothesis 3** (match for `x` only, no consistent pattern for `y`):
  also fails to describe rows 6–8 precisely (there both `x` and `y`
  match), and doesn't describe row 0 or rows 9–11 (there `x` doesn't match
  either, the difference being exactly 20 mm). Literally, hypothesis 3
  also **doesn't cover all rows**.

**None of the three hypotheses is confirmed by all rows.** The rows
contradict one another: the same pair "side + small non-rotated element"
gives a full match on one page (96), a match on the `y`-offset only on
another (9), and the same offset on both axes on yet others (8 and 97) —
and even then, the 20 mm / 10 mm offset is the same value across pages,
but which of the two pages gets it is unpredictable from the `side` or the
element type. `resolve()` never throws in the process and is stable in
itself (a small double-precision error, not chaos) — but its result's
relationship to `geometricBounds` isn't described by any of the three
hypotheses formulated.

**Conclusion: option 3.** Following rule 3 of the brief ("it is forbidden
to write a conclusion that hasn't been checked against every row"), the
phase stays on `geometricBounds` with forced conversion to points, as
already recorded in spec §3 item 2 and §11. The spec text was NOT edited —
the current wording is already correct: §11 says "until then the spec
relies on `geometricBounds` with forced units," and that "until then" is
now closed by this follow-up measurement's result, not left as an open
question.

`resolve()` remains a documented fact (it works in three spaces, and
depends on neither the ruler's units nor its zero point — these facts are
not refuted), but is unfit as an instrument for reading coordinates for
Task 3, because its relationship to `geometricBounds` doesn't obey any
simple conversion rule.

---

## `geometry_audit`'s response size on the fixture (Task 12, updated by Rounds 1 and 2)

`tests/integration/geometry-audit.test.ts`, run via
`INDESIGN_MCP_FIXTURES=1 npx vitest run tests/integration/geometry-audit.test.ts`,
live InDesign, fixture `__fixture_geometry` (13 elements, 1 page).
`buildReport(measure, [], { rotatedExcluded: 0, vectorGraphicsCount, emptyPopulations })`
— an empty findings list (the largest VARIABLE component — `findings` — is
absent; the measurement gives a LOWER bound for one empty response's byte
size, not an upper bound), BUT `vectorGraphicsCount` and `emptyPopulations`
are computed from the REAL fixture measurement (not a stub), exactly the
way `src/tools/geometry.ts` itself does it.

**Round 1 (plan-vs-spec review):** spec §8 names two items in
`notMeasured` that Task 11 hadn't wired up — "vector without ppi" and
"populations that don't exist in the document." `ReportOptions` was
extended with the `vectorGraphicsCount` and `emptyPopulations` fields
(`src/geometry/report.ts`), wired into `src/tools/geometry.ts` from the
family inventories (`inventoryAnchored`, `inventoryGraphics`,
`inventoryWrap`) — the same ones that go into the response's `inventory`
field, not a separate assumption next to it.

The `__fixture_geometry` fixture does NOT insert any images (a note by the
person who built it), so `image` is guaranteed to be an empty population on
it: the "No graphics in the document" line is a real finding from the
measurement, not a synthetic one. There are also 0 vectors in the fixture
(no images at all), so the vector line doesn't appear here.

**Round 2 (review):** the emptiness criterion for the `wrap` family was
wrong — `inventoryWrap().length === 0` doesn't catch the working book,
where `textWrapMode = NONE` on all 965 elements (`NONE` is also an
inventory entry, so the inventory is NOT empty, even though there's no
material for a verdict). The criterion was replaced with `hasWrapMaterial()`
(`src/geometry/wrap.ts`) — "there is at least one element with real
(non-`NONE`) wrap." The `__fixture_geometry` fixture DOES have real wrap
(`BOUNDING_BOX_TEXT_WRAP`/`JUMP_OBJECT_TEXT_WRAP`, see
`tests/integration/geometry-measure.test.ts`), so under BOTH criteria — the
old, wrong one and the new, correct one — `wrap` does NOT end up in this
fixture's `emptyPopulations`. **So the byte size on this fixture is
unaffected by the Round 2 fix** (verified with a separate negative control
in the test: `expect(emptyPopulations).not.toContain("wrap")`) — the
behavior change is on the WORKING BOOK (Task 14), not on this fixture. The
number below and the threshold remain the same as after Round 1, and this
is confirmed by a repeated measurement run, not left unchecked.

> **STALE AS OF 2026-08-15 (final-review fix wave, finding I2).** The
> numbers in this paragraph — 1861 B and threshold 3722 B — were taken with
> an instrument that turned out to be wrong. They no longer apply; what
> applies is below. The paragraph is kept because without it, it's unclear
> why the old numbers don't match the new ones.
>
> ~~Measured `Buffer.byteLength(JSON.stringify(report), "utf8")` = 1861 B,
> threshold 3722 B = 1861 × 2.~~

**WHY THE OLD NUMBERS WERE NOT COMPARABLE.** The measurement weighed
`buildReport(...)`, while the tool returned `ok({ ...report, inventory,
survey })`. Two separate discrepancies at once, both in the same
direction:

1. **`inventory` and `survey` were never weighed at all.** They were spread
   onto the report after `buildReport`, so they never entered the
   measurement — even though the graphics and anchored-population
   inventories are the bulkiest part of the response on the book.
2. **A COMPACT JSON was weighed, but the response is delivered indented.**
   `ok()` is `JSON.stringify(data, null, 2)`; the indentation alone
   accounts for roughly a quarter of the size.

So the threshold was taken from a response the user never actually gets.

**FIXED:** `buildReport()` now returns the WHOLE payload — `inventory` and
`survey` are its own fields, not an add-on beside it — and the tool does
`ok(report)`. There's nothing else left to weigh.

**RE-MEASURED 2026-08-15 on the same fixture:**

| What | Bytes |
| --- | --- |
| `ok()` response (indented) — **current number** | **3758** |
| the same report, compact | 3272 |
| ~~old measurement (report without `inventory`/`survey`, compact)~~ | ~~1861~~ |

Test threshold: **7516 B = 3758 × 2** (Phase 5's rule: a threshold pulled
out of thin air is worthless). The test has a negative control right up to
the threshold — the weighed string must contain `"inventory"`, `"survey"`,
and `"coordinateOrigin"`, otherwise the threshold would again apply to the
wrong response. After the run, InDesign has **0** documents open (the
fixture is closed in `afterAll`).

---

## Mutants (Task 13) — seven, each proven by EXECUTION

Rule: reasoning-based proof of a mutant doesn't count. For each one: an
exact change, an exact command, output with the `Test Files` line and exit
code SEPARATELY, the number of failed tests and the names of at least two,
with the revert verified against `git diff` for emptiness before the next
mutant.

Baseline state BEFORE mutations: `npx vitest run tests/unit` →
`Test Files 116 passed (116)`, `Tests 1927 passed (1927)`, exit 0.

Mutants 3–7 were run with `npx vitest run tests/unit`. Mutants 1–2 live in
`src/jsx/geometry.jsx` and are checked at INTEGRATION level: after every
`.jsx` edit, `npm run build` is mandatory (otherwise the run sees the old
copy in `dist/jsx/geometry.jsx`), the test is
`INDESIGN_MCP_FIXTURES=1 npx vitest run tests/integration/geometry-measure.test.ts`
(live InDesign, fixture `__fixture_geometry`; baseline state BEFORE
mutations — `Test Files 1 passed (1)`, `Tests 15 passed (15)`, exit 0).

| № | Mutant | File | Change | Command | `Test Files` / exit | Tests failed | Two names |
|---|---|---|---|---|---|---|---|
| 1 | instrument swapped | `src/jsx/geometry.jsx` | `p.allPageItems` → `p.pageItems` (+ `npm run build`) | `INDESIGN_MCP_FIXTURES=1 npx vitest run tests/integration/geometry-measure.test.ts` | `1 failed (1)`, `5 failed \| 10 passed (15)`, exit 1 | **5** | "negative control: a frame EXACTLY on the type-area boundary exists and is measured"; "anchored objects of three populations: TextFrame-number and zero-height GraphicLine" |
| 2 | forced units removed | `src/jsx/geometry.jsx` | removed the line `app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;` (+ `npm run build`) | `INDESIGN_MCP_FIXTURES=1 npx vitest run tests/integration/geometry-measure.test.ts` | `1 failed (1)`, `4 failed \| 11 passed (15)`, exit 1 | **4** | "near miss — 0.05pt past the left type-area boundary, no more and no less"; "wrap-offsets-inconsistent detector on a live measurement: an asymmetric offset produces a finding" (`expected 1 to be close to 12` — 12:1, exactly points vs. picas) |
| 3 | type area from `page.bounds` | `src/geometry/reference.ts` | added `+ page.width` to `leftMargin`/right coordinate in `typeArea` | `npx vitest run tests/unit` | `3 failed \| 113 passed (116)`, `5 failed \| 1922 passed (1927)`, exit 1 | **5** | "typeArea > is built from the page's own (0,0), not from page.bounds"; "typeArea > mirrors margins: inside on the left for recto, on the right for verso" |
| 4 | mirroring disabled | `src/geometry/reference.ts` | `leftMargin`/`rightMargin` always `margins.inside`/`margins.outside`, without `side === "left"` | `npx vitest run tests/unit` | `2 failed \| 114 passed (116)`, `2 failed \| 1925 passed (1927)`, exit 1 | **2** | "typeArea > mirrors margins: inside on the left for recto, on the right for verso"; "detectAnchorGeometry > stays silent about a frame with a named rule that the frame satisfies" |
| 5 | epsilon zeroed | `src/geometry/types.ts` | `EPSILON = 0.001` → `EPSILON = 0` | `npx vitest run tests/unit` | `5 failed \| 111 passed (116)`, `9 failed \| 1918 passed (1927)`, exit 1 | **9** | "EPSILON > larger than the double-precision error InDesign itself produces"; "detectOffPage > a full-bleed panel exactly at the bleed line is not a finding" |
| 6 | rotated included | `src/geometry/frame.ts` | removed `if (item.rotation !== 0) continue;` in BOTH places — `detectNearMiss` and `surveyNearMiss` | `npx vitest run tests/unit` | `1 failed \| 115 passed (116)`, exit 1 (initial run; see below) | **2** (after tests were added) | "detectNearMiss > excludes rotated frames from the verdict"; "surveyNearMiss > excludes rotated frames from the breakdown — the same gate as in detectNearMiss" |
| 7 | type-based branching removed | `src/geometry/image.ts` | removed `if (g.kind !== "raster") continue;` from `detectResolution` | `npx vitest run tests/unit` | initial run: `Test Files 116 passed (116)`, `Tests 1928 passed (1928)`, **exit 0 — MUTANT SURVIVED, zero failures**; after tests were added: `1 failed \| 115 passed (116)`, exit 1 (see below) | **0** at first → **2** after tests were added | "detectResolution > type-based branching is INDEPENDENT of the null check: kind !== raster is skipped even if effectivePpi happens to be populated"; "detectResolution > kind \"unknown\" with a non-empty effectivePpi — the same gate, for an unrecognized type" |

### Gaps that mutants 6 and 7 actually found — and how they were closed

**Mutant 6 initially killed only ONE test**
(`detectNearMiss > excludes rotated frames from the verdict`), even though
the change removes the gate in TWO functions. Reason: `surveyNearMiss` is a
separate function with its own copy of the rotation gate, and it had no
test of its own; the existing test `surveyNearMiss > returns the
breakdown...` contains no rotated element at all, so it never touches the
gate. This is a coverage gap, not equivalence (two functions with
independent copies of the same rule are a typical candidate for drifting
apart after a refactor). A test "excludes rotated frames from the
breakdown" was added to `tests/unit/geometry-frame-nearmiss.test.ts`: first
verified GREEN on clean code (`1928 passed`), then the mutation was
reapplied and rerun — **2** tests failed. The test stays in the suite.

**Mutant 7's initial run killed NO tests at all — it passed all 1928 tests
cleanly, `Test Files 116 passed (116)`, exit 0. The mutant SURVIVED
COMPLETELY, not "killed one test."** This is the task's most valuable
finding: a suite that looked complete (116 files, 1928 green tests) failed
to notice that an entire line of code had been removed. Reason: the only
existing vector test (`a VECTOR is never a finding`) builds its fixture with
`kind: "vector"` TOGETHER with `effectivePpi: null`, so the null check
(`g.effectivePpi === null`) catches this case on its own — the `kind` gate
was never separately checked by any test, so removing it broke nothing. In
production these two conditions always coincide (the JSX handler only
populates `effectivePpi` for `kind === "raster"`), BUT the `GraphicMeasure`
type doesn't guarantee this: nothing prevents a fixture (or a future change
to the handler) from giving `kind: "vector"` with a non-empty
`effectivePpi`. Two tests were added — for `kind: "vector"` and separately
for `kind: "unknown"`, both with a non-empty `effectivePpi` — in
`tests/unit/geometry-image.test.ts`: first green on clean code
(`1930 passed`), then the mutation was reapplied and rerun — **2** tests
failed. Both stay in the suite.

Neither mutant is equivalent, and neither remained unkilled after the added
tests.

### Final check

After reverting all seven mutants (`git diff` on the family files is
empty; only the added tests remain):

```
npm run build       → exit 0
npm run typecheck   → exit 0
npx vitest run tests/unit → Test Files 116 passed (116), Tests 1930 passed (1930), exit 0
```

`indesign_status` — 0 open documents, none active.

---

## Running the finished tool on the working book (Task 14)

Script `scripts/run-book-phase13.mjs` (verbatim from the brief), command
`npm run build && node scripts/run-book-phase13.mjs`. The book was opened
fresh via `indesign_run_jsx` right before the run (not through the
measurement script) — `modified = false` immediately after opening.

**Read-only status proven by the flag on a freshly opened document:**
`modified` = `false` BEFORE the run (right after opening) and `false`
AFTER the run (checked with a separate `indesign_run_jsx` between the run
and closing). The book was closed with `doc.close(SaveOptions.NO)` only
after this check.

### Run numbers against H13's expectations

| Number | Expected (H13) | Obtained (Task 14) | Discrepancy |
|---|---|---|---|
| elements | 965 | **965** | none |
| pages | 196 | **196** | none |
| anchored, total | 303 | **303** | none |
| — `Нумерація питань` | 185 | **185** | none |
| — `Зміст Номер сторінки` | 35 | **35** | none |
| — `GraphicLine` (not text) | 82 | **82** | none |
| — other (not text) | 1 | **1** | none |
| graphics, total | 6 | **6** | none |
| — raster (`Mother_1…4.psd`) | 4 | **4** | none |
| — vector (`logo.ai`) | 2 | **2** | none |
| wrap | `NONE` × 965 | **`NONE` × 965** | none |
| rotated frames | 91, all −90° | **91, all −90°** | none |
| links with status other than `NORMAL` | 0 (all 6 `NORMAL`) | **0** (`detectLinks` → `[]`) | none |

**No discrepancy at all.** The book hadn't changed in the respects H13
checked, despite the file being modified on 2026-08-14 22:39 — AFTER probe
H13 and BEFORE this run. The investigations described below concern not
discrepancies against H13 (there are none), but the tool's own output —
things H13 never counted at all, because the `frame`/`report` families
didn't exist in code yet.

### Investigation 1: four `frame-off-page` findings are exactly what H13 already named

`detectOffPage` (with no threshold — the `frame` family here doesn't take
`nearMissThresholdPt`, only `detectOffPage`, as in the brief's script) gave
**three grouped rows, four elements**: pages `2`+`128` (34.65 pt, count 2),
page `20` (90.38 pt), page `96` (72.74 pt).

This is not a new finding and not a discrepancy: H13 (section "Questions
11, 17") already counted **"only 14 elements go beyond the page itself
(10 by ≤ 10 pt, 4 by > 10 pt)."** The ">10 pt" bucket = **4** — exactly the
number `detectOffPage` gave now. The discrepancy between H13's "14" and
this "4" is expected and explained by the `bleedBox()` code itself: H13
counted overshoot past the PAGE FRAME, while `detectOffPage` counts
overshoot past the DECLARED BLEED (8.5 pt on three sides), which is wider
than the page. The elements in the "≤ 10 pt" bucket (10 of them) lie within
the bleed and so don't show up in `detectOffPage` — this is by design
(Task 7), not a blind spot.

Checking the elements on these four pages (a separate read-only query)
shows: on each of pages `20`, `96`, `128`, `2` there is a rectangle that
matches the bleed EXACTLY (`[-8.50, -8.50, 632.13, 538.58]`, like p. 96 in
H13 — NOT a finding), and a SEPARATE, larger element that goes further: pp.
2 and 128 by 34.65 pt, p. 20 by 90.38 pt, p. 96 by 72.74 pt. Pages 20, 96,
128 are exactly the pages of the three raster `Mother_N.psd` images (Task
8, the same measurement). This agrees with the natural reading: a full-bleed
illustration with its own decorative frame deliberately extends past the
standard text/panel bleed. **No verdict of a defect is made here** (the
tool likewise stays silent about intent) — but the number confirms H13
character for character, and this is the investigation's most important
result: exactly zero discrepancies.

### Investigation 2: the `surveyNearMiss` breakdown does NOT match H13's table — and shouldn't

`surveyNearMiss` gave `{≤0.01:15, ≤0.1:106, ≤1:10, ≤3:3, ≤10:170, >10:558}`
(sum of stationary elements 862 = 965 − 91 rotated − 12 within epsilon),
while H13's table "Questions 11, 17" gives `{≤0.01:1, ≤0.1:43, ≤1:2, ≤3:0,
≤10:17, >10:602}` with 300 "inside the type area."

> **BREAKDOWN NUMBERS CHANGED 2026-08-15 (fix C1).** Re-measured on the
> book after removing the double margin swap:
> `{≤0.01: 15, ≤0.1: 106, ≤1: 9, ≤3: 3, ≤10: 160, >10: 561}`, sum 854.
> The shift in the `≤1`, `≤10`, and `>10` buckets (−1, −10, +3; sum
> 862 → 854) is NOT an error and not a regression, but exactly what C1 was
> fixed to achieve: before 2026-08-15, the type area on 98 verso pages was
> wrong by 11.3386 pt on both vertical boundaries, so every near-miss past
> it was measured from the wrong lines. The old breakdown is valid only as
> history; comparing it to the new one is not correct. The
> "reconnaissance vs. tool" separation that explains the discrepancy
> against H13's table above is unaffected by this.

**This is NOT a discrepancy between measurements — these are different
instruments by design.** H13's probing script counted a near miss ONLY past
the type area's boundaries (`typeArea`). `surveyNearMiss` (the finished
`reference.ts` code, Task 5) counts the closest miss past ANY of all the
reference boundaries at once — type area, sheet, bleed, AND column
boundaries (`referenceEdges()` combines all four sources into one
deduplicated list). An element that missed a column boundary or a sheet
boundary, not just the type-area boundary, now enters the breakdown — so
there are more buckets and the numbers grew. Both instruments are correct
for their own definition; their buckets cannot be compared directly, and
this part of the brief ("every number that diverges is a finding or a
change in the book") doesn't apply to this case: here the *definitions*
diverged, reconciled in advance by the "reconnaissance vs. tool" split
(Task 3 vs. Tasks 6/7 are different modules).

### Response size on the working book

**Fixes Round 1 (Task 14 review): the first number (3011 B) was
understated, because `scripts/run-book-phase13.mjs` called `buildReport()`
DIFFERENTLY from how the tool itself calls it.** `src/tools/geometry.ts`
always computes and passes `vectorGraphicsCount` and `emptyPopulations`
(from the same inventories that go into the response's `inventory` field);
the script's first draft (verbatim from Task 14's brief, Step 1) never
passed these two options at all, so the report stayed silent about two
`notMeasured` lines that a user of the REAL `geometry_audit` call would
have received. The script was fixed — it now computes the same
`anchoredInventory`/`graphicsInventory`/`emptyPopulations`/
`vectorGraphicsCount` as `src/tools/geometry.ts`, using the exact same code.

Re-measured on the book AGAIN (a freshly opened document, a separate run,
not a number carried over from the review):
`Buffer.byteLength(JSON.stringify(report), "utf8")` = **3845 B** — with
four `frame-off-page` findings and **six** `notMeasured` items (rotated
frames; `anchorRule` not named; `minPpi` not named; **resolution of 2
vector images not assessed** — a new line; **no wrap applied to any
element in the document** — a new line, the `wrap` family is empty for a
verdict; the third `wrap` detector isn't implemented by design) and three
`caveats`. Verified with a separate run WITHIN the same InDesign session
(the same `geometry_measure`, building TWO reports — with the old options
and with the new — over one and the same measurement): the old variant
gave **3010 B** (within rounding error of 3011, the same measurement), the
new one **3845 B**, delta **835 B**, not 338 B as given by the reviewer's
separately reproduced check (the reviewer either passed only one of the two
options or missed this difference — checked NOT against the reviewer's
number, but by direct measurement on the live document, so 835 B is the
valid value).

> **STALE AS OF 2026-08-15 (fix wave, finding I2).** The 3845 B number
> above was taken with that same wrong instrument (compact JSON report
> WITHOUT `inventory`/`survey`) and no longer applies. Worse: it was also
> taken with the **phase's main detector disabled** — the run script only
> passed `detectOffPage` + `detectWrap` into `buildReport`, so
> `detectNearMiss` gave exactly zero findings in those 3845 B. The claim
> at the end of this paragraph that "`inventory`/`survey` are not part of
> `GeometryReport`" is simply false after the fix: they are now its
> fields.

**RE-MEASURED ON THE BOOK 2026-08-15** (`scripts/run-book-phase13.mjs`,
after all the wave's fixes; read-only, `modified === false` before and
after, closed with `SaveOptions.NO`). The script now passes
`nearMissThresholdPt = 1` — the natural-gap threshold from the `survey` of
that same run, as the spec §4.1 prescribes, not a round number:

| What | Value |
| --- | --- |
| elements / pages / traversal time | 769 / 196 / 225 ms |
| coordinate origin | `PAGE_ORIGIN`, `zeroPoint [0, 0]` |
| **`ok()` response size — current number** | **16,426 B** |
| the same report, compact | 12,411 B |
| findings in the report / total | 25 / 25 (`truncated: null`) |
| rows with a page list truncated to 25 | 1 |
| graphics inventory | 6 rows, not truncated |
| anchored inventory | 4 rows, 1 truncated by page |
| `notMeasured` / `caveats` | 7 / 3 rows |

Breakdown from `survey` in the same run:
`{≤0.01: 13, ≤0.1: 70, ≤1: 9, ≤3: 4, ≤10: 54, >10: 508}`.

> **THE BOOK CHANGED BETWEEN TWO RUNS ON THE SAME DAY.** The wave's first
> run gave **965 elements and 16,617 B**, the second (after the
> `MAX_ANCHORED_ROWS` cap) — **769 elements and 16,426 B**. The difference
> in elements is exactly **196 = the number of pages**, i.e. one element
> per page: the `_folio-helper` layer remained in the document, but now
> CONTAINS NO elements at all (verified by a per-page, per-layer count).
> The `survey` breakdown's sum also dropped by exactly 196 (854 → 658).
> The user removed the Phase 7/8 helper frames and saved the document
> between my runs.
>
> **So of the drop from 16,617 → 16,426 B, the cap accounts for almost
> nothing.** This book has four `anchored` populations, meaning the cap of
> 18 didn't trigger at all (`anchoredTruncated: null`) and only added one
> `null` field (~30 B). The rest of the delta is the disappearance of 196
> frames. Attributing the number change to my own fix would have been a
> mistake, and that's exactly why it's spelled out here.
>
> This is the second case in a row (after Phase 12) where **a criterion
> taken from a live document has an expiration date**: the book can change
> between the measurement and the run. The number above is valid as of
> 2026-08-15 and for a document composed of 769 elements.

**The growth against 3845 B is explained by three components, and none of
them is a regression** (the comparison should be against 3845 B, not
between the two runs of that day — see the note above for their
difference)**:** `inventory` and `survey` finally entered the measurement;
the response is weighed indented, not compact; and, most importantly,
`detectNearMiss` is now enabled, contributing 21 of 25 findings.
Separately: `formatPt` now gives four digits below 0.01 and thereby SPLITS
the densest band of the breakdown (≤0.01 → 15, ≤0.1 → 106) into more
distinct rows instead of one "0.00 pt" — i.e. the response deliberately
grew larger so that a 0.003 pt miss doesn't read as "no miss at all."

### The `MAX_ANCHORED_ROWS` cap — where the number 18 came from

**A measured risk that was named, and by the user's decision on 2026-08-15
was CLOSED.**

`inventory.anchored` was the ONE place in the response with no upper bound
at all: only the page lists INSIDE a row were truncated, but the number of
rows themselves could be arbitrary. A row is a pair "paragraph style ×
constructor type," so in an edition with many anchored-object styles, the
size would grow linearly and without limit.

Measured with a synthetic maximal report (`MAX_DETAIL_ROWS = 60` finding
rows filled, each with `MAX_PAGES_PER_ROW = 25` pages, and 60 graphics
inventory rows), calling `buildReport` directly:

| `inventory.anchored` rows | BEFORE the cap | AFTER the cap |
| --- | --- | --- |
| 4 (as in the book) | 68,485 B | 68,516 B |
| 20 | **78,991 B** | 77,748 B |
| 60 | 105,271 B | 77,748 B |
| 200 | 197,351 B | 77,749 B |
| 500 | 394,751 B | **77,749 B** |

~657 B per row, linear and with no cap — the same class of failure that
once knocked out Phase 4 with 78 KB.

**WHERE 18 CAME FROM.** Not from the cap itself and not "with margin": it's
the LARGEST cap at which the pathological case stays under 78,000 B — under
the size that had already broken the tool historically. Calculation:
`68,485 + (18 − 4) × 657 ≈ 77,683 B`; measured after implementation —
**77,749 B**, under the limit. From below, the cap is anchored by the
book's measurement: there are FOUR populations there, so 18 leaves a real
edition a 4.5× margin and never triggers on this document at all
(`anchoredTruncated: null`).

The cap is ALWAYS accompanied by the `inventory.anchoredTruncated` field
(`{shown, total}`): a silent truncation here would be worse than a large
response, because the inventory is a claim about the document's
COMPOSITION, and a shortened list with no warning would read as "there are
no other anchored objects in the book."

**WHAT THE CAP DOES NOT FIX — stated honestly.** It makes the response
FINITE (394,751 → 77,749 B), but it doesn't bring the pathological case
much below 78 KB: already at four anchored rows, the filled caps give
~67 KB, and most of the weight there isn't in `anchored` but in 60 findings
across 25 pages each and 60 graphics-inventory rows. So the **2× margin
taken on the fixture remains a property of this specific document, not a
property of the tool**, and an edition capable of filling the finding and
inventory caps will still produce a response of the order that once
knocked out Phase 4. This is a named, valid limitation, not this wave's
debt.

The working book is far from this: 16,426 B — 21% of the 77,749 B
worst-case. No autotest fails.

### The `modified` flag

`false` right after `app.open()` (fresh baseline state) → `geometry_measure`
run (990–1237 ms depending on the pass, read-only `page.allPageItems`
traversal) → `false`, verified with a separate query → the book closed with
`doc.close(SaveOptions.NO)`. No write occurred: `geometry_audit` proved its
read-only status on a real document, not just on a fixture.


---

## Final-review fix wave (2026-08-15) — two new measurements

Both probes are tracked, so the numbers below can be re-measured, not just
trusted from a comment. This is the wave's direct lesson: the first draft
of the measurement lived in `.superpowers/`, which is in `.gitignore`, so
there was nothing in the repository to re-measure against.

### Measurement C1: `marginPreferences.left` is the INSIDE margin on both sides

Probe `scripts/probe-h13-margins.jsx`. Book `Book 260811-1645.indd`,
196 pages, read-only, `modified === false` before and after.

The raw margin signature is ONE across all 196 pages:
`top 51.0236 | left 79.3701 | bottom 60.5764 | right 90.7087` — i.e.
`mp.left`/`mp.right` don't depend on side.

The widest non-rotated `TextFrame` on each page, aggregated across both
boundaries:

| Side | `x1 ≈ mp.left` | `x1 ≈ mp.right` | `x2 ≈ W−mp.left` | `x2 ≈ W−mp.right` | frames |
| --- | --- | --- | --- | --- | --- |
| recto | **128** | 0 | 0 | **107** | 138 |
| verso | 0 | **119** | **132** | 0 | 142 |

**Zero counterexamples in either direction, on either boundary.**
`mp.left` = 79.3701 is the inside margin on BOTH recto and verso;
`mp.right` = 90.7087 is the outside one. InDesign never swaps them.

So the mirroring is REAL, and exactly one place should perform it. Before
2026-08-15, the swap lived in TWO places: `src/jsx/geometry.jsx` and
`typeArea()` (`src/geometry/reference.ts`). Composing two swaps is the
identity: `typeArea` returned `[top, mp.left, H−bottom, W−mp.right]` on
BOTH sides — meaning there was no mirroring at all, even though both places
declared it in comments. On the 98 verso pages, the type area and column
boundaries were wrong by **11.3386 pt** (`90.7087 − 79.3701`) on both
vertical boundaries.

The swap was removed from `geometry.jsx`; `typeArea()` was left as is.
Probe H13 (pass 4, `probe-h13-model.jsx:64-65`) was right from the start —
the bug was in the tool's code, not in the reconnaissance.

### Measurement I3: a rotated frame's `geometricBounds` is a TIGHT envelope

Probe `scripts/probe-h13-rotated-bounds.jsx`. Its own temporary document,
closed with `SaveOptions.NO`; does not touch the working book.

| Action | `geometricBounds` | width × height |
| --- | --- | --- |
| rectangle before rotation | `[100, 100, 140, 400]` | 300 × 40 |
| `rotationAngle = −90` | `[100, 60, 400, 100]` | 40 × 300 |
| `rotationAngle = 45` | `[−112.1320, 100, 128.2843, 340.4163]` | **240.4163 × 240.4163** |

`(300 + 40) / √2 = 240.416305603426` — an EXACT match, and `visibleBounds`
gives the same numbers.

**A check at 45° is mandatory here.** At −90° a simple side swap
(40×300) looks exactly like a tight envelope — this angle doesn't
distinguish the hypotheses at all. An arbitrary angle does.

Consequence for the `rotation !== 0` gate present in `detectNearMiss` and
absent from `detectOffPage`:

- **alignment**: the envelope's SIDES are not the frame's sides ⇒ the
  question "does the frame's edge sit flush with the column's edge" can't
  be decided from it → the gate is needed;
- **going past the bleed**: the envelope is TIGHT ⇒ it crosses the bleed
  boundary if and only if some CORNER of the frame goes past it → the
  verdict is exact, and the gate would be a loss of real findings (91
  frames in the book).

So the inconsistency the review noticed is visible, but not a flaw:
different questions require different instruments. This is stated
explicitly in `detectOffPage` and in the report's `notMeasured`. The
decision is guarded by two sentinels in
`tests/unit/geometry-frame-offpage.test.ts` — before which a mutant "add
the gate here too" passed the whole suite green.
