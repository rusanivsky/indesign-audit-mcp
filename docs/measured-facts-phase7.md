# Measured facts, Phase 7 — probe `H7`

Date: 2026-08-07. Run through the built branch (`npm run build`, then
`runJsx` from `dist/`), **not** through `mcp__indesign__*`: the MCP server was
running from the repo's main checkout and would have silently served the old
build.

Document: **`Book 260807-0100.indd`, 196 pages**. `doc.modified` was
`false` before the probe and `false` after — all measurements on the book are
read-only. Mutating measurements run on **the probe's own temporary
documents**, which it creates and closes itself (`SaveOptions.NO`); after the
run, exactly one document remains open in InDesign — the user's book.

**Application: Adobe InDesign 21.4.1.4** (`app.version`, written into every
run's result).

Scripts:

- `scripts/probe-h7-book.jsx` + `scripts/probe-h7-book.mjs` — Questions 1–3,
  read-only on the book, plus a **positive control for the measurement code**
  on its own fixture;
- `scripts/probe-h7-markers.jsx` + `scripts/probe-h7-read.mjs` — Questions
  4–16, on their own fixture (68 pages) plus a separate document for
  Question 12.

**The fixture's reproducibility is stated explicitly** (review, Important 9):
page size **612 × 792 pt**, not inherited from the user's typical document
(on a narrower size the probe's positions would have run off the page, and
Question 13 would have silently measured "no overlap"); PDF export settings —
`pageRange = ALL_PAGES`, `exportLayers = false`, `viewPDF = false`, set
before export and restored after. The last one matters: with
`exportLayers = true` a hidden layer could have made it into the PDF, and
Question 8's answer would flip.

Questions 13 and 14 were added after the first run: Question 1 uncovered a
strategy the spec never considered. Questions 15 and 16, and a second round
of Question 9, were added after the 2026-08-07 review.

---

## Measurement method, and two instruments that had to be fixed

A marker's resolved value **cannot be read from the DOM** —
`character.contents` returns exactly the `SpecialCharacters` enumeration.
The measurement goes through PDF export and `pdfjs-dist`, as in `H6`.

**Difference from `H6`: the label is bounded on BOTH sides** —
"`N4=`⟨marker⟩`#`". `H6` took everything up to the next label, i.e. it
depended on whatever was drawn next to it. The fixture's thread filler is
deliberately **digit-free**, for the same reason.

Two instruments broke during this probe, and both gave plausible-looking
answers:

| What broke | What it looked like | Why |
|---|---|---|
| four labels didn't print | `null` — would read as "the marker doesn't work" | `doc.layers.add()` makes the new layer **active**, and everything created afterward landed on the hidden / non-printing layer |
| `doc.undo()` in Question 12 | "Unable to undo the last command" | the undo step created by this very call is still **open**; undo was moved to a separate call, and the "one step" fact was proven via `doc.undoName` |

The negative control (`AUTO_PAGE_NUMBER`, whose answer is known in advance)
gave **"5" on page 5** in the final run — the instrument is sound.

---

## Question 1: distribution of folios — and forty pages the tool cannot see

| What | Value |
|---|---|
| `Колонтитул v1`-style frames on document pages | **91** |
| of them **recto** | **91** |
| of them **verso** | **0** |
| pages with these frames — odd / even | **91 / 0** |
| anchored among them | **0** |
| rotation angle | **−90° on all 91** |
| layers | `Нумерація в сторінках` 26, `Шар 1` 65 |
| bounds source (all 91) | `resolve()`, no fallback to `geometricBounds` |
| `Колонтитул v1` frames on PARENT pages | **8** |
| pages with an un-overridden master `Колонтитул v1` item | **69** |
| of them **with no frame of their own** | **40** (all even — this is the running header, not a number) |
| of them **with their own frame too** | **29** (all odd) |

**Phase 6's conclusion "all folios are on recto" is confirmed — but for 91
frames, not 20.** The 91/0 numbers refer specifically to frames carrying a
page NUMBER.

### NONE ARE OVERRIDDEN: all 91 frames are drawn from scratch

**This is a measurement, not a conclusion drawn from the absence of a
master item on the page.** The frame's own properties were read directly:

| What | Value |
|---|---|
| `pageItem.overridden` | **`false` on all 91** |
| frames with a valid `overriddenMasterPageItem` | **0 of 91** |
| layer × origin | "from scratch": `Нумерація в сторінках` 26, `Шар 1` 65 |

**Two earlier drafts counted "62 overridden" using the criterion "the page
has no live master item with that style." The criterion is wrong:** it is
equally true both for "the master item was overridden" and for "a master
without a folio was applied here, and the frame was drawn from scratch."
It turned out to be the latter — in all 91 cases.

The tell that would have exposed this without the DOM was sitting in my own
numbers: **overriding preserves the element's layer.** The master folio
sits on `Нумерація` (hidden), while all 91 frames sit on
`Нумерація в сторінках` and `Шар 1`. None is on the hidden layer, so none
can be an override.

The distribution is explained by the page's applied master:

| Page master | Frames | Does the master have its own folio |
|---|---|---|
| `F-Шаблон інтерв'ю` | 40 | no |
| `J-Розділ 3 текст колонтитули` | 12 | **yes** |
| `E-Розділ 1 текст колонтитули` | 10 | **yes** |
| `D-Розділ 2 текст колонтитули` | 7 | **yes** |
| `H-Чеклисти Р1 колонтитули` | 6 | no |
| `N-Чеклисти Р3 колонтитули` | 5 | no |
| `G-Шаблон без колонтитулів` / `C-Передмова` / `M-Чеклисти Р2 колонтитули` | 3 + 3 + 3 | no |
| `I-Зміст` | 2 | no |

**10 + 7 + 12 = 29** — exactly the pages where the master's folio is alive
and sits underneath the manual one; on the remaining **62** the applied
master has no folio at all, so there is nothing to override there.

| Category | How many |
|---|---|
| overridden master items | **0** |
| drawn from scratch, page master **without** a folio | **62** |
| drawn from scratch **on top of** a live master folio | **29** |

Pages with two folios: 23, 31, 39, 41, 49, 57, 65, 67, 89, 93, 99, 101, 107,
109, 117, 121, 125, 131, 141, 153, 163, 165, 169, 171, 181, 183, 185, 187,
191. The manual frame and the master frame sit there **exactly on top of
each other**: page-relative bounds `[51, −68, 563, −22.7]` vs.
`[51, −68, 563.1, −22.7]`, a difference of **`[0, 0, 0, 0]`** (to within 0.1
pt on one bound), both rotated −90°.

**Three claims in earlier drafts were false:**

| Was said | In fact |
|---|---|
| "fixed by overriding EVERY recto" | overrides are **zero**; all 91 frames are drawn from scratch |
| "62 are truly overridden" | 62 is the count of pages where the **applied master has no folio** |
| "91 is the complete list of folios WITH A NUMBER" | still true, but on a different basis: see below |

### Yet only one folio prints — the master's sits on a HIDDEN layer

The DOM shows an item's presence, not what makes it onto the sheet. So three
pages of the book were exported to PDF (exporting a document does not
change it; `doc.modified` was `false` before and after):

| Book page | Folio fragments in PDF | What exactly |
|---|---|---|
| 23 | **1** | `22–23` |
| 101 | **1** | `100–101` |
| 191 | **1** | `190–191` |

The cause is the document's layer registry:

| Layer | State | What's on it |
|---|---|---|
| `Нумерація в сторінках` | visible | 26 manual folios |
| `Шар 1` | visible | 65 manual folios, master running headers |
| **`Нумерація`** | **HIDDEN** | **all three master automatic folios** |
| `Layer 8`, `Шар 4` | hidden | — |

**In other words, the broken automatic folio wasn't deleted — it was
SWITCHED OFF via a layer.** This is the same lever as in Question 8: a
hidden layer neither prints nor lets the marker resolve. The user had
already found it before the probe did.

**Consequence for the phase:** the folios with a number that ACTUALLY
print are still **91**, so the phase's scope doesn't change. But 29 pages
carry a **sleeping duplicate**: if the `Нумерація` layer is ever turned back
on, a second folio of the form "N–N" will print on them. This is a
candidate finding for §4.9 — not because it lies right now, but because the
saved document state contains a ready-made lie behind a switch.

**What nobody saw.** This is a **SECOND, SEPARATE** blind spot, and it must
not be conflated with anchored frames (fixed after the 2026-08-07 review):

| What is invisible | To what |
|---|---|
| anchored frames | `page.textFrames`. **`allPageItems` SEES them** — Phase 6 measured 3 vs. 11, and that's exactly why the pass switched to `allPageItems` |
| **un-overridden master items** | **NEITHER `page.textFrames` NOR `page.allPageItems`** — a separate source, `page.masterPageItems`, is needed |

Probe `H6` walked `page.textFrames` (`scripts/probe-h6-book.jsx:60,79`, zero
references to `allPageItems`), so both classes were invisible to it. Under
the second blindness sat the following:

| Master | Side | Content | Literals | Markers |
|---|---|---|---|---|
| `E-Розділ 1 текст колонтитули` | recto | `⟨marker⟩–⟨marker⟩` | **none** | `previous-page-number`, `auto-page-number` |
| `D-Розділ 2 текст колонтитули` | recto | `⟨marker⟩–⟨marker⟩` | **none** | `previous-page-number`, `auto-page-number` |
| `J-Розділ 3 текст колонтитули` | recto | `⟨marker⟩–⟨marker⟩` | **none** | `previous-page-number`, `auto-page-number` |
| `E` / `D` / `J` | verso | "Вагітність — це новий світ", "ПОЛОГИ — ЗУСТРІЧ З МАЛЮКОМ", "ПЕРШІ МІСЯЦІ З МАЛЮКОМ — ЖИТТЯ НА ДВОХ" | — | — |
| `C-Передмова`, `I-Зміст` | verso | "Передмова", "ЗМІСТ" | — | — |

Two things, each of which changes the picture of the phase:

1. **Phase 7's target state already exists in the book — on the master.**
   The folio `⟨PREVIOUS_PAGE_NUMBER⟩–⟨AUTO_PAGE_NUMBER⟩` with no literal at
   all is exactly what the phase set out to build. It has already been
   hand-built, three times over.
2. **A running header with the chapter name DOES exist in the book.**
   Phase 6's conclusion "there is no running header" (Question 5) came from
   this same blind spot: the running headers sit on masters' verso. This
   doesn't concern Phase 7 (§2 puts the running header out of scope), but
   Phase 6's record is wrong and needs to be corrected.

The master folios sit on the `Нумерація` layer (`visible = false`), the
master running headers sit on `Шар 1` (visible). In other words, only the
number was switched off; the running header was left working.

**Why the master's automatic folio didn't resolve — measured.** The folio
frame on masters `E`, `D`, `J` **overlaps nothing** (`overlaps: []`). By
Question 10, such a `PREVIOUS_PAGE_NUMBER` prints its OWN page — i.e. the
master prints "N–N." This is exactly the defect the book had on 2026-08-04
(52 folios reading "96–96"). It was fixed **not by overriding**, but by two
other actions: the master folio was switched off via the `Нумерація` layer,
and a new frame with a manual left-hand number was drawn on top — **and
that is exactly how the 91 manual literals that Phase 6 now finds came to
be**. On 62 of the 91 pages, a master with no folio at all was used for
this besides.

---

## Question 2: direction of the range — `backward`, no exceptions

| Mutual order | Frames |
|---|---|
| **manual number to the LEFT of the auto-marker** | **91** |
| manual number to the right | 0 |
| no marker / no literal / other | 0 |

The content shape is identical across all 91: `N–⟨auto-marker⟩`. The
direction derived by the oracle (manual number against its own page):
`previous` in **91 of 91**.

**`folio.range: "backward"` is confirmed for this book; no frame has the
other direction.** This confirms the parameter's value, not a rule: §4.3
remains in force, and no default kicks in.

---

## Question 3: route A coverage — ZERO out of 91

| Side | Total | **Covered** | no overlap | overlaps, but not the thread | thread, no neighbor | neighbor on the wrong page |
|---|---|---|---|---|---|---|
| **recto** | 91 | **0** | 84 | 7 | 0 | 0 |
| **verso** | 0 | **0** | — | — | — | — |

The expected page was taken **from the manual number itself** ("6–⟨marker⟩"
on p.7 means "the marker should resolve to 6"), i.e. from the document, not
from a layout convention.

**First control — distance.** "No overlap" is a claim a broken measurement
would reproduce identically:

| Distance from the folio | min | median | max |
|---|---|---|---|
| to any text frame | **0.0 pt** (the same 7) | 22.7 pt | 107.0 pt |
| to the THREADED frame (n = 68) | **22.7 pt** | 22.7 pt | 107.0 pt |

Plus: **23 folios sit on pages that have no threaded frames at all.**

The reason is visible in the geometry: all 91 frames are rotated −90° and
sit as a narrow strip near the outer edge (45 × 512 pt), while the text
column begins 22.7 pt further in. **This book's folio structurally overlaps
nothing.**

### Breakdown of the seven overlaps that do exist

| Kind | How many | With what |
|---|---|---|
| `touch` (contact within 0.01 pt — the PROBE's unit, see below) | **7** | `[Basic Paragraph]`, `containers: 1` |
| `strict` (intersection area > 0) | **0** | — |

**THE TOLERANCE UNIT IN THE PROBE AND IN THE PRODUCT DIFFER, and this is
stated, not equated.** Probe `probe-h7-book.jsx` sets
`MeasurementUnits.POINTS` (line 32) and uses `EPS = 0.01`, i.e. **0.01 pt**.
The `pagination_measure` handler sets `MILLIMETERS`, so
`IDMCP.BOUNDS_EPSILON_MM = 0.01` — that is **0.01 mm ≈ 0.028 pt**, roughly
three times wider a tolerance.

On the measured contacts there is no difference: all seven are exactly
**0.0 pt**, so they land inside both tolerances alike. But assuming that a
coincidence of numbers is a coincidence of quantities would be wrong: the
next book with a 0.02 pt contact will get DIFFERENT answers from the probe
and from the product.

Frames overlapping two or more threads: **0**. Frames with conflicting
neighbors: **0**.

### Second control — POSITIVE, and without it zero proved nothing

The first draft relied on distances alone, and that was **insufficient**:
the branch "neighbor → page → check against the oracle" never executed on
the book **even once** (`threadedOverlaps` = `{"0": 91}`, `strict` = 0). A
bug in exactly this branch would have produced these very same numbers
(review, Important 3).

So **the same measurement code** (`probe-h7-book.jsx`, `build-control`
phase) is run against its own fixture with numbers known in advance:

| Branch | Expected | Measured |
|---|---|---|
| total frames | 8 | **8** |
| **covered** | 5 (pages 3, 5, 6, 7, 15) | **5 (3, 5, 6, 7, 15)** |
| neighbor on the wrong page | 1 | **1** |
| overlaps, but not the thread | 1 | **1** |
| no overlap | 1 | **1** |

**Control passed:** the same code produces a non-zero `covered`, including
on **verso** (page 6, direction `next`) — a branch the book doesn't have at
all. Not just counters are checked, but the exact **set** of covered pages
too: otherwise the control would pass on a different fixture with the same
coverage count.

**The control caught a bug in the control itself:** a separate, unthreaded
frame had been placed on a page that also had a threaded frame, and the
fixture returned `covered` instead of `overlapNoThread`. Fixed by moving it
outside the thread.

### The `spreadBox` flaw: its origin, and why the control did NOT catch it

Bounds were taken from TWO corners (`[0,0]` and `[1,1]`). For multiples of
90° the diagonal still coincides with the bounding rectangle, but for an
arbitrary angle two corners **understate** it, so a book with a folio at 45°
would silently report "no overlap." Fixed to use **four corners**.

**Found by READING THE CODE on a cue from Important 5, not by the control.**
An earlier draft of this document credited the control with the finding —
untrue: the control frame at 45° at that point lay **entirely inside** the
threaded frame, so both variants gave `covered` alike. The branch that
distinguishes two corners from four simply wasn't in the control, and a
regression back to two corners would have passed green.

Now such a branch exists (page 15 of the control fixture), and it is
**self-calibrating**:

| What | Value |
|---|---|
| box from FOUR corners | `x 179.3…345.5`, `y −316.7…−150.5` |
| box from TWO corners | `x 179.3…345.5`, **`y −292.0…−175.3`** |
| neighboring frame's placement band (measured) | `y −173.3…−151.5` |
| `covered` | **yes** |
| **verdicts a two-corner box would have changed** | **1** |

The first attempt to build this branch **missed**: I separated the frames
along the X axis, but the bounds diverge along **Y**.

**The cause is NOT the rotation's reference point.** That's what an earlier
draft said, and it's wrong: changing the reference point is a pure
**translation**, it shifts `b4` and `b2` identically, so the difference
`b4 − b2` is invariant to it and cannot change which axis diverges.

**The real cause is the sign of rotation in a system with the Y axis
pointing DOWN.** A two-corner box is the bounding box of the TL→BR diagonal
itself, so its extent along each axis equals that diagonal's projection.
For a 200 × 35 frame at 45°:

| | half-extent X | half-extent Y |
|---|---|---|
| true bounding box, `(w·cos + h·sin)/2` and `(w·sin + h·cos)/2` | 83.09 | 83.09 |
| diagonal, `(w/2)cos − (h/2)sin` and `(w/2)sin + (h/2)cos` at **−45°** | **83.09** | **58.34** |

So along X the diagonal gives exactly as much as the full bounding box (at
45° this is not a coincidence: both equal `(w + h)·cos45 / 2`), while along
Y it understates by `h·cos45 = 24.74` on each side. Extents: 166.2 / 166.2
vs. 166.2 / **116.7** — **exactly the measured numbers**.

At the opposite rotation sign the same formulas give 116.7 along X and
166.2 along Y — the axes swap. So the axis of understatement is determined
by the **direction** of rotation, not by an application setting.

Self-calibration doesn't depend on any of this — it tries both axes — but
the recorded fact still has to be correct, because it is exactly what will
travel into the next edition.

### Whether the flaw affected the book's numbers — MEASURED, not argued

The earlier justification ("all 91 frames are at −90°, so there's no
difference") was one-sided: `overlapKind` takes **two** rectangles, and the
probe never records the counterpart frame's angle anywhere. So both box
variants are now computed side by side for every pair:

| What | Value |
|---|---|
| overlap verdicts across all 91 frames that a TWO-CORNER box would have changed | **0** |

Plus a second, more honest reason why the first draft's numbers turned out
unchanged: `probe-h7-book.mjs` measures the book **in the same run** as the
control, i.e. with the already-fixed code. So "the numbers didn't change"
is not an observation across two runs, but a measurement of the difference
between two formulas within one.

---

## Question 4: `NEXT_PAGE_NUMBER` exists and is symmetric

All four enum values are defined: `AUTO_PAGE_NUMBER`, `NEXT_PAGE_NUMBER`,
`PREVIOUS_PAGE_NUMBER`, `SECTION_MARKER`.

Fixture: a thread on pages 6→7→8→9→10→11, labels on page 8.

| Label | Marker | Expected | In PDF |
|---|---|---|---|
| `C4` | `AUTO_PAGE_NUMBER` | 8 | **8** |
| `N4` | `NEXT_PAGE_NUMBER` | 9 | **9** |
| `P4` | `PREVIOUS_PAGE_NUMBER` | 7 | **7** |

**Retroactively validates Phase 6's classifier.** If the name didn't exist,
`pagination.jsx:31` would give `undefined`, the comparison would never be
true, and "0 `next-page-number` markers in the document" would prove
nothing.

---

## Question 5: the helper thread works on a broken main-text story

Page 7: a helper-thread frame (previous one on p.6) sits next to a
**separate story** that is not part of the thread. The label overlaps both.

| Label | In PDF | Meaning |
|---|---|---|
| `H5` | **6** | previous page — **the helper thread works** |

So wherever the main text breaks (chapter openers, interviews, checklists),
the helper thread gives the correct number. This is the material basis for
route B.

---

## Question 6: from a PARENT page the thread does NOT work — and `allPageItems` cannot see it

| Case | Label | In PDF | Expected | Conclusion |
|---|---|---|---|---|
| master thread, frames **not overridden** | `M6` (p. 19) | **19** | 18 | **does not resolve**, prints its own page |
| the same master, frames **overridden** | `O6` (p. 23) | **23** | 22 | also does not resolve |

The topology explains both results, and they are **different in cause**:

| What | Value |
|---|---|---|
| p. 19 without override: `page.textFrames` / `allPageItems`-text / `masterPageItems` | 1 / 1 / **1** |
| thread of the master item on p. 19 | `containers: 2`, `prevPage: "B"` — the **MASTER's page**, not the document's |
| p. 23 with override: `page.textFrames` / `allPageItems`-text / `masterPageItems` | 2 / 2 / 0 |
| thread of the overridden frame on p. 23 | **`containers: 1`** — the override **BROKE** the thread |

**Two answers, both negative:**

1. **`page.allPageItems` does NOT see un-overridden master items.** On p. 19
   it returned 1 (the label itself) while `masterPageItems: 1`. This is the
   same pass's second blind spot, after anchored frames — and it is exactly
   what hid 40 pages and the book's running header (Question 1).
2. **A thread on a master remains the MASTER's thread:** the previous frame
   sits on page "B," meaning the marker has no document page to resolve to.

**A measurement limit, stated aloud:** the override was done per element
(`masterItem.override(page)`), and it is that call which broke the thread.
Whether some other override path preserves the thread was **not
measured**. This doesn't matter for the phase (the helper thread of §4.8 is
built on document pages), but the claim "override doesn't help" without
this line would overreach the measurement.

---

## Question 7: in an ANCHORED frame the marker behaves the same

Frame created via `insertionPoints[-1].textFrames.add()`, `parent` of type
`Character`, page 10; the host overlaps the threaded frame whose previous
one is on p. 9.

| Label | In PDF | Expected |
|---|---|---|
| `A7` | **9** | 9 |

**The `skipped: anchored-frame` reason in §4.4 is NOT needed.** Aside: this
book has zero anchored folios anyway (Question 1).

---

## Question 8: a hidden layer DOES mute the marker; not-for-print — no

The §4.8 question concerns the **helper-thread's** layer, not the folio's
own layer: a hidden folio wouldn't show up in the PDF at all, and the
measurement would answer an empty question.

| Helper-thread layer | Label | In PDF | Expected | Conclusion |
|---|---|---|---|---|
| `visible = false` | `HID` (p. 13) | **13** | 12 | **resolution lost** — prints its own page |
| `printable = false` | `NPR` (p. 17) | **16** | 16 | **resolution preserved** |

**This is the probe's most dangerous finding, exploitation-wise.** One click
on the eye icon of the `_folio-helper` layer in InDesign silently turns
every automatic folio into "N–N" — the same defect the book had on
2026-08-04, and it will look exactly as always.

---

## Question 9: the thread CREATED EARLIER wins — i.e. the main text

Three cases, in each of which the two threads' neighbors sit on **different
pages**, so the answer is unambiguous.

| Case | Page | Helper says | Main says | Stacking order | Creation order | **In PDF** | Winner |
|---|---|---|---|---|---|---|---|
| `W9` | 9 | 8 | 3 | main HIGHER | helper earlier | **8** | helper |
| `Z9` | 11 | 10 | 2 | **helper HIGHER** | helper earlier | **10** | helper |
| `V9` | 25 | 24 | 21 | helper higher | **main earlier** | **21** | **main** |

Two hypotheses tested explicitly (the numbers include the second round,
`U9` + `Y9`, i.e. five cases, not three):

| Hypothesis | Match |
|---|---|
| the one created earlier wins (lower `id`) | **5 of 5** |
| the one earlier in `page.allPageItems` wins | 1 of 3 (in the first round) |
| the topmost / bottommost by stacking wins | disproved by `Z9` vs. `V9` |
| more containers wins | disproved by `U9` (second round) |
| larger overlap area wins | disproved by `U9` and `Y9` (second round) |

**Case `V9` — the one matching reality — is the one that flipped the
answer.** The first draft of the probe only had `W9` and `Z9`, where the
helper thread was created EARLIER than the main text. But the phase adds
the helper thread **into an already-finished document**, i.e. it is created
LAST — and in that case the main text wins.

**A consequence the spec never anticipated: the helper frame does NOT
override the main thread.** Wherever a folio already overlaps a main-text
frame, route B has no power at all — the main thread decides, whether we
want it to or not.

### Second round: three hypotheses instead of one, and two of them rejected

The first draft declared "the one created earlier wins" a measured rule.
**That was premature** (review, Important 4): the same three cases equally
explained two other hypotheses, because the relevant variables never
varied in them —

- **(b) more containers**: `W9` 6:3 → helper, `Z9` 6:2 → helper, `V9` 2:2 →
  main. `V9` — the only case where the later one lost — is exactly the one
  where the container counts **tied**;
- **(c) larger overlap area**: in all three cases the competing frames had
  **identical bounds**, so the area never varied anywhere.

This bears directly on §4.2: the phase will place the helper frame
**exactly** underneath the folio, while the main-text frame will only
graze its edge — on the book, all 7 existing contacts are exactly that
(`touch`). If a larger area won, the rule would flip.

Two cases separate all three:

| Case | Page | Helper | Main | Prediction (a) created earlier / (b) containers / (c) area | **In PDF** | Winner |
|---|---|---|---|---|---|---|
| `U9` | 49 | **6 containers, EXACTLY under the label, created LAST** → 48 | 2 containers, 2 pt touch, created earlier → 41 | main / **helper** / **helper** | **41** | **main** |
| `Y9` | 59 | 3 containers, EXACTLY under the label, created LAST → 58 | **6 containers**, 2 pt touch, created earlier → 55 | main / main / **helper** | **55** | **main** |

**Both alternatives rejected.** In `U9` the helper had both more containers
and a vastly larger overlap area — and lost. In `Y9` the helper had the
larger area — and lost. Exactly one hypothesis remains: **the thread
created earlier wins**.

This **strengthens** the first round's conclusion rather than softening it:
`U9`'s configuration is exactly the one the phase will create (a helper
frame exactly under the folio, added last into a finished document), and
in it the main text wins even with just a 2 pt touch.

The exact underlying mechanism (creation order, or something monotonically
tied to it, like `id`) was not investigated further: for the phase it is
enough that **a later-created frame does not win under any of the
advantages tested**, and that stacking order has no effect on this, i.e.
`bringToFront` is not a usable control.

---

## Question 10: without a neighbor the marker SILENTLY prints its own page

| Case | Label | In PDF | Empty? |
|---|---|---|---|
| FIRST frame of the thread, `PREVIOUS_PAGE_NUMBER` | `F10` (p. 6) | **6** | no |
| LAST frame of the thread, `NEXT_PAGE_NUMBER` | `X10` (p. 5) | **5** | no |

No blank, no warning — **a plausible-looking wrong number prints**. This is
exactly the fail-silent mode §4.9 requires the `folio-marker-unbound`
detector for: a frame with no literals never produces a finding, so without
a new detector such a folio is blind forever.

---

## Question 11: character formatting survives the replacement

| State | Text | Character size | Character color |
|---|---|---|---|
| before replacement | `S11=42#` | 30 pt | `Зонд-Червоний` |
| after replacement with `AUTO_PAGE_NUMBER` | length 6, the character **is a marker** | **30 pt** | **`Зонд-Червоний`** |

In the PDF, label `S11` on p. 15 gave **"15"** — the marker both resolves and
keeps its formatting.

**Consequence:** re-applying character formatting after the write is not
needed; `replace-literals` changes content only.

---

## Question 12: one undo step — yes; cost — under a second

A separate temporary document, 20 pages. **All numbers come from ONE run**
(the final one); the first draft stitched together two different runs
without saying so (review, Minor 10).

| What | Value |
|---|---|
| creating layer `_folio-helper` + **196 frames** | **1,123 ms** |
| `doc.saveACopy` | **113 ms**, copy size **2,424,832 B** |
| total | **1,238 ms** |
| frames after the write | 196 |
| **name of the next undo step** | **`Зонд H7 (власна фікстура)`** |
| `redoName` | empty |

### `saveACopy` on the REAL book, not extrapolated

113 ms on a 2.4 MB fixture said nothing about a 16 MB book (review,
Important 8). Measured on the book itself — `saveACopy` doesn't change the
document (`doc.modified` `false` before and after):

| What | Value |
|---|---|
| book's source file | **16,068,608 B** (16.07 MB) |
| **`doc.saveACopy`** | **225 ms** |
| copy size | 10,182,656 B (the copy is more compact than the working file) |
| copy deleted after measuring | yes |

**A measurement limit, stated explicitly:** the copy was written to the
**system temp folder**, not the book's own folder. The original sits in a
synced Google Drive folder
(`~/Library/CloudStorage/GoogleDrive-…`), and the **"synced destination"
axis was NOT measured** — the probe does not write to the user's own folder
without their own permission. Only the "document size" axis was measured:
16 MB vs. 2.4 MB gives 225 ms vs. 113 ms — roughly double, not an order of
magnitude.

**The layer, the 196 frames, and `saveACopy` all sit in ONE undo step** —
the user's Cmd+Z would remove it in one go.

**A negative instrument result, stated honestly:** `doc.undo()` itself, run
from the script, does not execute ("Unable to undo the last command")
either directly or after `app.activeDocument = doc`, because the step
created by this very call is still open. The "one step" fact was proven
**by the step's name, not by executing it** — a weaker form of proof, and
§9 must verify the undo by hand.

---

## Question 13: the helper thread does NOT bring the master folio to life

The question follows from Question 1: if the master folio
`⟨PREVIOUS⟩–⟨AUTO⟩` is silent only for lack of overlap, then a helper frame
underneath it should bring it to life — and then, instead of replacing 91
literals, one could **revert the pages to the master** (it was first
phrased as "removing 91 overrides"; overrides, as it later turned out,
number zero — it would mean deleting 91 frames and turning a layer back
on).

**This is not Question 6.** There, the thread lived on the master and had a
neighbor on the master's own page. Here the thread lives on **document
pages**, threaded in page order, while the master item merely overlaps it
geometrically.

Fixture: a master with frame `T13=⟨PREVIOUS⟩-⟨AUTO⟩#` at position
`(320, 60)–(500, 95)` from the page edge; a helper thread **with text** on
pages 26→27→28→29 **in the same position**; the master applied to pages
28–29, frames **not overridden**.

| What | Value |
|---|---|
| helper thread | pages 26, 27, 28, 29 |
| master items on p. 29 | 1 |
| page-relative bounds of the master frame | `[60, 320, 95, 500]` |
| page-relative bounds of the helper frame | `[60, 320, 95, 500]` |
| **difference** | **`[0, 0, 0, 0]`** |
| **`T13` in the PDF** | **`29-29`** |
| expected, had it worked | `28-29` |

The geometric match is **measured**, not inferred from the construction
(review, Minor 13): without this, "the marker doesn't see the thread"
cannot be told apart from "the frames simply don't overlap."

**Answer: NO.** A marker in an un-overridden master frame does not see a
thread sitting under it on the document page, and prints its own page
twice.

The loophole from Question 9 was closed in advance: the helper thread was
created **earlier** than the master was applied, meaning creation order
worked in its favor — and still didn't help.

### Question 13b (aside, and a positive one): an EMPTY helper thread works

§4.2 requires the helper frame's content to be empty, while everything the
probe had measured so far contained text. A separate pair of pages with no
master at all:

| What | Value |
|---|---|
| thread: frames in the story / characters | **2 / 0** |
| **`E13` in the PDF** (p. 35, previous frame on p. 34) | **`34`** |

**An empty story doesn't hinder resolution** — §4.2's "content is empty"
requirement is safe.

---

## Question 14: removing an override discards it — along with every edit

Measured even though the strategy is no longer alive after Question 13:
`removeOverride()` exists and works.

Page 33: the same master, a helper thread underneath; the frame was
overridden, deliberately **shifted by 5 pt**, and its content replaced with
`T14=999#`, then the override removed.

| State | `masterPageItems` | `textFrames` | Frame bounds |
|---|---|---|---|
| before override | 1 | 1 | — |
| after `override(page)` | **0** | **2** | `[65, 937, 100, 1117]` (shifted) |
| after `removeOverride()` | **1** | **1** | `[60, 932, 95, 1112]` — **the original master values** |

Plus: after removal the overridden frame becomes **`isValid === false`** —
the object is destroyed, no need to delete it by hand.

| `T14` in the PDF | `33-33` |
|---|---|

**Two answers:**

1. **A way to remove an override without manually deleting the frame
   exists:** `pageItem.removeOverride()`. The page reverts to the master
   item, `masterPageItems` returns to 1.
2. **Removal discards ALL per-instance edits** — both position and content.
   The bounds reverted to the master's, and the text `999` vanished without
   a trace. The risk the coordinator flagged is **measured and confirmed**.

`T14 = 33-33` agrees with Question 13: the master item came back, but the
marker inside it still prints its own page.

---

## Question 15: in a ROTATED frame the marker resolves — at either angle

100% of this book's target frames are rotated −90°, and the fixture, before
the review, had **no** rotated frame at all (review, Important 5).

| Label | Frame angle | Page | Previous thread frame | In PDF |
|---|---|---|---|---|
| `R90` | **−90°** | 62 | 61 | **61** |
| `R45` | **45°** (arbitrary) | 64 | 63 | **63** |

**A rotated frame does not stop the marker from resolving.** Neither at
this book's angle nor at an arbitrary one.

The geometric half of the same question — whether `spreadBox` correctly
gives overlap for a rotated frame — is closed by Question 3: the two-corner
variant understated the bounding box for an arbitrary angle, fixed to four
corners, and the 45° control frame gives `covered`.

---

## Question 16: in an OVERRIDDEN master item the marker works — but this book has none of them

**The configuration this question concerns does NOT exist in the book.**
The question was asked under the thesis "62 of 91 target frames are
overridden master items," which was later **disproven by measurement**:
`overridden = false` on all 91, zero overrides (Question 1). The
measurement remains valid and useful — but as a fact about
**portability**, not a description of this layout; a full reassessment
follows at the end of the section.

What exactly was tested and why: `O6` placed the label in a SEPARATE frame
above a broken thread, not a marker **inside** the overridden item itself
(review, Important 6).

Fixture: a master with folio `T16=⟨PREVIOUS⟩-⟨AUTO⟩#`, a helper thread on
document pages 65→66→67 at the same position, the master item on p. 67
**overridden and left in place**.

| What | Value |
|---|---|
| `overridden` | `true` |
| `masterPageItems` on p. 67 after override | 0 |
| `textFrames` on p. 67 | 2 |
| containers in the overridden item's story | 1 |
| **`T16` in the PDF** | **`66-67`** |

**Answer: YES.** An overridden master item behaves like an ordinary
document frame: the marker inside it sees the helper thread underneath and
resolves to the previous page.

**But it doesn't concern this book.** The question was asked under the
thesis "62 of 91 target frames are overridden master items," and that
thesis turned out false: overrides in the book measure **zero**
(Question 1). So the risk this question was meant to close never existed
here.

**The question's value is portability.** Together with Question 13 (a
master frame **without** an override cannot be brought to life), it gives
the complete rule for editions where the folios really are overridden
master items: replacing the literal will work there, while trying to skip
the override will not.

---

## Question 17: master bounds arrive in the coordinates of the MASTER spread

**Posed by the Task 3 review as blocker B1, and as a HYPOTHESIS, not a
fact.** Spec §4.1 called this an "open question": with `SPREAD_ORIGIN`, zero
sits at the corner of the spread the element BELONGS to, and for
`page.masterPageItems` that is the master's own spread. Whether the axes
diverge when the page's position within its spread ≠ the master page's
position within the master spread was never measured: the fixture had
`masterCount: 0`, and the book run never checked master bounds against
anything.

**Instrument.** Three own documents (Letter, 215.9 × 279.4 mm), units in
mm, `rulerOrigin = SPREAD_ORIGIN`. Frames with known offsets FROM THEIR OWN
PAGE'S CORNER were placed on parent pages; next to each, on the document
page, a frame with the SAME offsets. The second one is the "actual
location" reference.

### State 1: the book's first page, a lone recto in a spread — DIVERGE

Master spread pages: `[0] LEFT_HAND x = 0…215.9`, `[1] RIGHT_HAND
x = 215.9…431.8`. Frame `MR` sits on the right-hand master, offset 30 mm
from the page corner.

| What is read | Raw numbers |
|---|---|
| page "1", `RIGHT_HAND`, position **0** of 1, `bounds` | `x = [0 … 215.9]` |
| `masterPageItems[0]` (`MR`, master position **1**) | **`x = [245.9 … 295.9]`** |
| document frame with the same offset on page "1" | **`x = [30 … 80]`** |

**A 215.9 mm discrepancy — exactly one full page width.**

Control on the same document: page "3" (`RIGHT_HAND`, position **1** of 2,
`x = [215.9 … 431.8]`) gives `x = [245.9 … 295.9]` for the same frame, and
the document reference there is also `[245.9 … 295.9]`. **They match.**

### State 2: a three-page spread — DIVERGES on the third page

Spread `[2, 3, 4]`, built via `allowPageShuffle = false` and
`pages.add(AFTER, last page of the spread)`. (`pages.add(AT_END, spread)`
does NOT create three pages — it adds one ordinary page to the end of the
document.)

| Page | Position in spread | `bounds` | `masterPageItems` gave | reference on the page |
|---|---|---|---|---|
| "2" | 0 | `x = [0 … 215.9]` | `MV`, `x = [10 … 60]` | matches |
| "3" | 1 | `x = [215.9 … 431.8]` | `MR`, `x = [245.9 … 295.9]` | `[245.9 … 295.9]` — matches |
| "4" | **2** | `x = [431.8 … 647.7]` | `MR`, **`x = [245.9 … 295.9]`** | **`[461.8 … 511.8]`** |

The third page gets the right-hand master (position 1), so the discrepancy
is again exactly 215.9 mm.

### State 3: `SINGLE_SIDED` — MATCH

Document page at position 0, master page also at position 0.
`masterPageItems[0]` → `x = [30 … 80]`, document reference → `x = [30 … 80]`.

### The answer and its consequences

**The coordinate systems do NOT match, and the reviewer's hypothesis is
confirmed by measurement.** One rule covers all three states: offset =
`page.bounds` minus `element.parentPage.bounds`, i.e. **the difference
between the two pages' corners**. Neither the page width nor the number of
pages in a spread is needed — the reference is derived from the document
(§3.2), so the rule is portable.

`parentPage` of a master item = the MASTER's own page (verified:
`parentPage` returned "A", `parent instanceof MasterSpread` → `true`). If
`parentPage` is empty (the element sits across the master spread's gutter),
there is nothing to reconcile against — the bounds stay raw, and this is a
named limit.

**The cost of missing this would have been silent.** Without reconciliation
the master folio on the book's first page would sit past the right edge of
its own spread, overlap nothing, and §4.9 would see no sleeping duplicate
on it at all — reporting "clean."

### Question 17b (aside): the "skip writing `rulerOrigin`" branch is LIVE

The review suspected the comparison
`previousOrigin === RulerOrigin.SPREAD_ORIGIN` was dead code, because the
same file carries a fact measured by Phase 4: "comparing an enum on read is
always false." **Checked by execution — the suspicion is wrong:**

| Document state | `String(v)` | `v === RulerOrigin.SPREAD_ORIGIN` | `Number(v)` |
|---|---|---|---|
| after writing `SPREAD_ORIGIN` | `SPREAD_ORIGIN` | **`true`** | 1380143983 |
| after writing `PAGE_ORIGIN` | `PAGE_ORIGIN` | **`false`** | 1380143215 |

Phase 4's finding concerns `NothingEnum.NOTHING` — an empty value, not
enums in general. The branch works, and it is exactly what saves the user's
book from an unnecessary write; it must not be removed.

---

## Question 18: a thread WITH A GAP — the marker prints the FRAME's page, not "minus one"

Date: 2026-08-08. Probe `scripts/probe-h7-gap.jsx` + `probe-h7-gap.mjs`, its
own 8-page temporary document, `facingPages`, closed without saving.
Resolved values were read from **PDF**, because in `contents` the marker
remains the character `\u0018` — exactly the trap that made Question 5 read
structure instead of print output.

**Why.** Question 5 measured a CONTINUOUS thread, where "the thread's
previous frame" and "page `offset − 1`" coincide, making the two
impossible to tell apart. Here they are deliberately separated: the thread
sits **only on odd** pages — exactly how a helper thread would land under
the rule "a frame wherever there's a folio."

| Label on | Previous THREAD frame | Page `offset − 1` | **PRINTED** |
|---|---|---|---|
| 1 | — | — | **1** |
| 3 | 1 | 2 | **1** |
| 5 | 3 | 4 | **3** |
| 7 | 5 | 6 | **5** |

**The page of the PREVIOUS THREAD FRAME prints in all three cases where the
rules diverge.** So the assumption "the marker resolves to `offset − 1`" is
false the moment the thread has a gap.

**Consequence for this book, had the §4.2 contract not been stated:** all
91 folios are on recto, the thread would land on odds, and p. 97 would
print "95–97." **91 lying markers out of 91**, each looking correct.

**Aside, confirms Question 10:** the label on p. 1, which has no previous
frame at all, printed its **own** page ("1"), not a blank and not a
warning.

**This probe's first attempt had its own flaw, and it's instructive:**
bounds were given as numbers instead of via `page.bounds`, so under
`facingPages` a frame added to page "3" landed geometrically on "2" —
`parentPage` honestly reported "2," and the structure looked broken. This
is the same class of bug as blocker B1 of Task 3: spread coordinates versus
page coordinates.

## Question 19: NEITHER of the two locks stops the text write — neither the layer lock nor the frame lock

Date: 2026-08-08. Probes `scripts/probe-h7-lock.jsx` + `probe-h7-lock.mjs`
(the main measurement) and `scripts/probe-h7-lock-control.{jsx,mjs}`
(control over geometry and deletion); own temporary documents, both closed
without saving, `app.documents.length === 0` after each.

**Why.** Task 11 had incidentally measured that a frame on a locked layer
has `ClaimFrame.locked === false`, and that a write through it goes through
(`applied: 1`). The claim had to be either confirmed by its own measurement
or disproven — and the **two different locks** had to be told apart,
because "locked" in InDesign means two different properties on two
different objects: `frame.locked` and `frame.itemLayer.locked`.

**Method.** Eight frames with the literal "42": four lock states × two
interaction levels (default and `NEVER_INTERACT`, since the production
handler writes inside `IDMCP.withNoInteraction`). The write is exactly the
production one:
`para.characters.itemByRange(0, 1).contents = SpecialCharacters
.PREVIOUS_PAGE_NUMBER` (`pagination-write.jsx:264`). Success is checked by
**re-reading** the paragraph, not by the absence of an exception: "didn't
throw" and "wrote" are different claims, and the question here is exactly
whether a forbidden action goes through silently.

### Raw numbers

| State | `frame.locked` | `itemLayer.locked` | interaction | threw | text after | **wrote** |
|---|---|---|---|---|---|---|
| A — both unlocked | `false` | `false` | default | — | `` | **yes** |
| B — the FRAME locked | **`true`** | `false` | default | — | `` | **yes** |
| C — the LAYER locked | **`false`** | **`true`** | default | — | `` | **yes** |
| D — both locks | **`true`** | **`true`** | default | — | `` | **yes** |
| A2 | `false` | `false` | `NEVER_INTERACT` | — | `` | **yes** |
| B2 | **`true`** | `false` | `NEVER_INTERACT` | — | `` | **yes** |
| C2 | **`false`** | **`true`** | `NEVER_INTERACT` | — | `` | **yes** |
| D2 | **`true`** | **`true`** | `NEVER_INTERACT` | — | `` | **yes** |

`` here is the inserted `PREVIOUS_PAGE_NUMBER`; the literal "42" disappeared
in all eight states.

### Control: the locks really WERE applied, and they are real

Eight-for-eight "wrote" leaves two hypotheses open: either the lock never
applied, or it applied but doesn't affect a text write. An operation on the
**element** itself tells them apart:

| State | `frame.locked` | `itemLayer.locked` | `geometricBounds = …` | moved | `frame.remove()` | gone |
|---|---|---|---|---|---|---|
| A | `false` | `false` | — | **yes** | — | **yes** |
| B | `true` | `false` | **`Object is locked.`** | no | **`Object is locked.`** | no |
| C | `false` | `true` | **`Object is locked.`** | no | **`Object is locked.`** | no |
| D | `true` | `true` | **`Object is locked.`** | no | **`Object is locked.`** | no |

So InDesign does apply both locks — just **to the page item, not to its
text**. Geometry and deletion are forbidden in B, C, and D; replacing a
character is forbidden in none of them.

### Unambiguous answers

1. **Does a LAYER lock protect the frame from our write? NO.** States C and
   C2: the layer is `locked === true`, the frame gets rewritten anyway.
   Task 11's finding is **confirmed**, and confirmed by a separate probe,
   not by hearsay.
2. **Does the measurement see this? NO.** `frame.locked`, for a frame on a
   locked layer, reads `false` (state C). The two locks are two independent
   flags, and `ClaimFrame` carried only one of them.
3. **AND A THIRD THING NOBODY ASKED FOR: a lock on the FRAME ITSELF also
   doesn't stop the write** (states B, B2). This disproves the claim
   recorded in the code at `SkipReason: "locked-frame"` and in
   `pagination-write.jsx`'s message — "a physical InDesign restriction,
   InDesign will refuse." **InDesign does not refuse.** Our own handler
   refuses, and that is its own decision.

**A consequence, and it's about the whole of step 7 §4.4.** Both lock-based
refusals are **our own policy**, not a physical restriction, and step 7 no
longer splits into "two physical InDesign restrictions" and "one policy of
ours." The policy is correct: the layout artist sets the lock, and they
have every right to treat it as a guarantee. But calling it a physical
restriction means writing into a comment a reason nobody ever measured —
and it's exactly that reason the probe just disproved. Comments were fixed,
behavior strengthened: `ClaimFrame` gained `layerLocked`, the oracle a
separate `locked-layer-frame` reason, and the write handler a separate
refusal.

**Why there are two reasons, not one.** State C is a lock an operator will
not see on the frame itself: it's on the layer. Collapsing both into
`locked-frame` would send the operator off to unlock something that isn't
locked. This is the same confusion between a frame's own `layerVisible`
and the overlapping one's `layerVisible` that already cost the phase a
round.

## Question 21: a master thread LOSES to a document thread, despite an older story

> **NUMBER CORRECTED.** This measurement was first logged as "Question 20,"
> but that number already belonged to the Task 11B measurement (below in
> this file, about re-measuring helper frames) — committed earlier.
> **Numbering follows the order the measurements were TAKEN in, not their
> place in the file.**

Date: 2026-08-08. Measurement from review `11g`, own temporary document,
resolved values from the PDF. **This is the first measurement of the
REVERSE state:** Questions 6 and 13 measured a marker **inside** a master
frame; here the marker is a document one, and the thread underneath it is
the master's.

Conditions: the master thread is **older** (`story 252`) than the document
one (`298`), the geometry is identical, both overlap the folio.

| What sits under the folio | Printed |
|---|---|
| master thread only | **3** — its own page, i.e. NO resolution |
| master + document | **4** — the **document** one won |

**So InDesign itself does not count master threads**, and
`documentThreadLinks`, which discards them (`topology.ts:120`), is not a
narrowing but a model of the physics. This closes the arithmetically
scariest suspicion: on the book, 90 of 91 frames have overlaps, and all of
them are master ones.

**But this very measurement found a CLASS OF EXCEPTIONS to Question 9's
rule.** "The one created earlier wins" was measured on 5 cases via the
proxy `Number(story.id)`. Here the older story **lost** — because origin
matters more than age. So the rule has at least one boundary, and it needs
its own check on the working book (Task 15) rather than being treated as
universal.

## Question 22: the marker's binding is STICKY — hiding a layer isn't always reversible

Date: 2026-08-08. Measurement from review `11d`, own document, values from
the PDF, reproduced **twice**.

| State | Action | Printed |
|---|---|---|
| **two** threads under the label | initial | `2` |
| | hide the winner | `1` |
| | **turn the layer back on** | **`1`** — DID NOT revert |
| **one** thread (this book's case) | initial | `2` |
| | hide it | `3` (its own page) |
| | turn back on | **`2`** — reverted |

**Consequence for §4.8.** The spec calls hiding a layer a reversible
action — that's true only while a single thread sits under the label.
When there are two, InDesign remembers the choice of winner, and turning
the layer back on doesn't restore the previous state.

The book is expected to be the first case (route A gives 0 of 91, i.e.
under each folio there's only the helper thread), but **this is a
prediction, not a measurement** — Task 15 checks it.

**This doesn't add a sixth entry:** a probe using the real
`pagination_apply` showed that, after the write, the PDF prints the same
`2–3`.

## Two measurement traps that carry over into Task 8

**1. An offset in a STRING ≠ a CHARACTER index.** `character.contents`
returns the enum name not only for markers but for typographic characters
too: the folio "6–⟨marker⟩" assembles into the string `"6EN_DASH￼"`. The
marker sits at **position 8 in the string** and at **position 2 among
characters**.

The write handler addresses characters (`characters.itemByRange`), so the
offset must be **character-based**. A string offset would rewrite the
wrong character — precisely wherever a literal sits after a special
character. `IDMCP.claimParagraph` (`pagination.jsx`) assembles the string
the same way, so `ClaimParagraph` must carry **`charOffset`**, not a text
offset.

**Honest limit of this warning: on THIS book it has ZERO cases where it
would fire.** All 91 literals sit at the start of the paragraph, i.e. have
`offset = 0 = charOffset`; only the marker offsets differ (8 vs. 2), and
nobody rewrites the marker. Checking whether this warning fires on this
book is **impossible in principle** — it is correct for the future (a book
where the manual number sits to the right of the dash, i.e. after a
special character) and must stay, but presenting it as measured on this
layout would be wrong (review, Minor 14).

**2. Two coordinate systems.** `geometricBounds` and `resolve(...,
CoordinateSpaces.SPREAD_COORDINATES)` for the same frame diverge on Y by
**311.81 pt** (they match on X). Overlap is computed in only ONE system;
mixing them would produce a false zero or a false hit. The probe computes
via `resolve()`.

---

## Measurement time

| Pass | Time |
|---|---|
| a read-only pass over 196 pages (91 folios, pairwise overlaps) | **437–3,553 ms** per run |

**The eight-fold spread is explained, not glossed over** (review,
Minor 12): 437 ms came from a run where InDesign had already warmed up the
document from a prior pass; 3,553 ms came from a run right after exporting
three book pages to PDF, i.e. on a busy application. Both are the same code
on the same document; what changes is InDesign's state, not the
measurement. For planning purposes, take the **upper** bound.

Phase 6's measured 820 ms for `pagination_measure` no longer applies
(§4.1), but the order of magnitude is the same: pairwise overlap checks
fit within seconds, not minutes.

### Run on the working book, 2026-08-08 — and a Critical that never was

**A/B on the SAME document in the SAME session**, book
`Book 260807-0100.indd`, 196 pages, `folioStyle: "Колонтитул v1"`,
invoked through the `dist` branch (not through `mcp__indesign__*`). Only
`dist/jsx/pagination.jsx` was swapped, i.e. exactly the pass's code
differs:

| code | runs | median |
|---|---|---|
| before the fix round (`30775d2`) | 7,577 / 4,508 / 6,038 ms | **6,038 ms** |
| after the fix round (`c8c7a61`) | 3,426 / 3,341 / 2,985 ms | **3,341 ms** |

The win on the BOOK is **−45%**, i.e. bigger than the synthetic instrument's
−30.8%, not smaller. The instrument's critique (review `c8c7a61`, C1: 5
master frames per page vs. 0–1 in the book) was **not confirmed** by
measurement: the error's direction turned out to be the opposite of what
was predicted.

**MAIN POINT: there never was, and there still isn't, a Critical timeout
issue.** The ceiling `PAGINATION_MEASURE_TIMEOUT_MS` is 120,000 ms. Even the
code BEFORE the fix round fit within **6 seconds**, i.e. 5% of the ceiling;
afterward, 2.8%.

The numbers **183,450 / 74,201 / 122,793 ms**, out of which the entire
Critical grew, are **false**. The coordinator recorded them, and it was
those numbers, not the code, that produced the conclusion "the
already-merged tool will fail every other run." What exactly was measured
back then couldn't be reproduced; the only certainty is that it wasn't
this. The likeliest suspects: a different invocation path (the MCP server,
launched from the MAIN checkout, serves `main`'s code, which has no third
source) or InDesign concurrently running someone else's mutating
integration test suite — that same-day incident is documented separately.

**The lesson matters more than the number itself.** This very section
already contained a measurement of "seconds, not minutes" — and it was
overridden by a one-off observation, checked against nothing. The rule
"measurement governs the spec" only protects when a new measurement is
checked against the old one, and a 20x discrepancy is treated as grounds
to suspect the instrument, not as a discovery.

**Measured incidentally on the live document:**

- the working book's `doc.viewPreferences.rulerOrigin` is **`PAGE_ORIGIN`**,
  not `SPREAD_ORIGIN`. So the write branch does fire, and `finally` really
  does restore it: after six passes the value returned to `PAGE_ORIGIN`,
  `modified` stayed `false`, `saved` was `true`;
- `masterOverlapsOnly` (folio frames whose overlaps are ALL master ones):
  **0 → 83** out of 119 that have overlaps. Before the fix round it was
  zero only because `ThreadLink` had no `fromMaster` field and there was
  nothing to distinguish them by. **This is the measured basis for blocker
  B2 on the real book:** without this field, 83 frames would have gone down
  the `thread` route, the oracle wouldn't have resolved against a dead
  master thread, and all 83 would have come out looking like legitimate
  skips.

---

## Side measurements

Everything below was measured by **Task 3** (2026-08-07) on the implemented
measurement pass, not by a probe.

### The instrument was shared, and it corrupted every absolute time number

During these runs the same InDesign instance was concurrently running
**someone else's integration test suite** from another worktree: the
document list kept showing and hiding `fixture.indd`,
`composition-fixture.indd`, `Untitled-403/404` in turn, and the active
document switched between calls. Two measurements had to be discarded as
having been taken on someone else's single-page document
(`folioFrames: 0`).

The consequence must be read literally: **that day's absolute
milliseconds cannot be compared to anything**, including Phase 6's 820 ms —
Phase 6's own code, in this session, gave 13,000–55,000 ms. Only
**interleaved** A/B pairs, taken back-to-back, can be compared, and
everything below was measured exactly that way.

### `pagination_measure` time, interleaved A/B

Fixture `__fixture_make_pagination`, 10 pages, 4 trials per variant, the
active document confirmed to be the fixture before each trial:

| Code | min | median | max |
|---|---|---|---|
| Phase 6 (HEAD) | 13,010 ms | 14,328 ms | 14,548 ms |
| **Phase 7 (geometry + overlap + master)** | 13,061 ms | **15,040 ms** | 15,083 ms |

The difference is ≈3%, i.e. **within the noise of a shared instrument**.
These numbers are relative; on an UNLOADED InDesign the same call in the
same session cost **383–404 ms** (a separate `pagination_measure` call in
the `missingStyles` test), and that is the working estimate for the
fixture.

The working book, 196 pages, interleaved in one session:

| Code | Trial 1 | Trial 2 |
|---|---|---|
| Phase 6 (HEAD), 91 frames | 50,877 ms | 54,841 ms |
| Phase 7, 160 frames | 94,720 ms | — |
| Phase 7 **without writing `rulerOrigin`**, 160 frames | 99,766 ms | — |

Two conclusions, both relative: the new pass costs **≈1.8–1.9× Phase 6's**
(frames grew from 91 to 160, plus pairwise overlaps), and **writing
`rulerOrigin` costs nothing** — the variant without it isn't faster.

### The third source of frames: 69, and all 69 predicted by Question 1

A read-only run on the working book, `folioStyle: "Колонтитул v1"`:

| What | Value |
|---|---|
| `folioFrames` total | **160** |
| of which `fromMaster: true` | **69** |
| of which `fromMaster: false` | 91 |

69 is exactly 40 + 29 from Question 1, i.e. **the third source delivers
exactly what was missing**, not "something else." Broken down by layer:

| Layer | Visible | For print | Source | How many |
|---|---|---|---|---|
| `Шар 1` | yes | yes | page | 65 |
| `Нумерація в сторінках` | yes | yes | page | 26 |
| `Шар 1` | yes | yes | **master** | **40** |
| `Нумерація` | **no** | yes | **master** | **29** |

The last row is the same **29 sleeping duplicates** (§5a), and now they can
be computed straight from the measurement: `fromMaster && !layerVisible`.
Before Task 3, this data didn't exist at all.

### The "84 vs. 1" discrepancy explained: it isn't a bug, it's the third source

The first run gave an alarming number: of the book's 91 own folios, **90**
overlap something, whereas Question 3 measured 84 with **zero** overlap.
Traced with three measurements in a row, on the same document:

| What was counted | 0 overlaps | 1 | 2 | 3 |
|---|---|---|---|---|
| `geometricBounds`, neighbors = page + master | 1 | 71 | 5 | 14 |
| `resolve()`, neighbors = page + master | 1 | 71 | 5 | 14 |
| `geometricBounds`, neighbors = **page only** | **84** | **7** | 0 | 0 |

**Instrument disagreement — ZERO** (`disagree: 0` on all 91;
`boxSource`: `resolve` on 890 of 890). The last row is **exactly** the
84/7 of Question 3.

So the entire difference is exactly those master frames the probe never
saw. The number 84 isn't disproven, it is **redefined**: "nothing
overlaps" was a claim about an incomplete population.

**CONSEQUENCE FOR TASK 5, AND AN UNPLEASANT ONE.** These new overlaps
**are not usable for route B**: the thread doesn't work from a parent page
(Question 6), and the helper thread doesn't bring a master folio to life
(Question 13). So `overlaps` now holds links that are geometrically real
and functionally dead — and `ThreadLink` **carries no origin marker**,
leaving no way to tell them apart from inside it. Either `ThreadLink` gets
a sixth field, or Task 5's topology needs to get the origin some other way.

> **Closed by Task 3F:** `ThreadLink` got a sixth field, `fromMaster`. Data
> is not discarded on input — master overlaps stay in the list, tagged.

### Cost of the pass: master resolution re-ran on EVERY page

A counter, taken by execution on a **book-scale synthetic document** (196
pages, a parent with a folio on both pages, a running header, and a GROUP
of two frames; every document page has its own "N–⟨auto⟩" folio). Two
versions of the handler run back-to-back on ONE document.

The metric is executed `try` blocks: in this file almost every touch of
InDesign is wrapped in `try`, since the DOM throws on nearly any property.
The counter was inserted mechanically, as the first line of every
`try {`, via the SAME text substitution for both versions.

| | before (HEAD `4d128dc`) | after (Task 3F) |
|---|---|---|
| executed `try` blocks | **15,082** | **10,444** (−30.8%) |
| handler time, ms | 810 | 566 (−30.1%) |
| `isTextFrameLike` calls | **1,176** | **206** (−82.5%) |
| `frameBounds` calls | **1,372** | **204** (−85.1%) |
| `styleNameOf` calls | 2,352 | 1,764 (−25.0%) |

`1,176 = 196 × 6`: on every page, 1 document frame and 5 master items
(folio, running header, a group, and two frames inside it) were freshly
re-checked. After the cache — `206 = 196 × 1 + 10`, i.e. the master is
resolved **once**, not 196 times.

**An incidental fact from the same run, and it's about correctness, not
speed:** `headings` on this document dropped from **196 to 0**. A running
header on the parent page was being collected as a body heading once per
EVERY page — 196 phantom headings from a single object. The `contents`
family matches headings by order, so this isn't just extra data, it's a
shift that stales every subsequent table-of-contents line.

> **"RESOLVED ONCE" APPLIED TO STRUCTURE, NOT TEXT.** The sentence above is
> true for `isTextFrameLike`, unfolding a group, and `geometricBounds`, but
> character-by-character parsing of the master folio still ran on every
> page — `styleNameOf` only dropped 25% then, versus 82–85% for the cached
> structural calls. What was done about this, and why exactly that much, is
> the next section.

### ROLE cache vs. TEXT cache: both measured, one kept (Task 3G)

A different instrument, deliberately: the earlier one (5 master items per
page) systematically overstates the very savings it's proving (Critical
C1 of review `c8c7a61`). This one is built to the book's **measured
proportions**: 100 pages, a drawn folio on 46% of them (91 of 196 in the
book), a master with a folio on recto and a running header on verso
applied to 76 pages (≈0.76 master items per page vs. 0.35–1 in the book).

**A/B interleaved in ONE session on ONE build** — the cache was toggled by
a flag inside the code, so neither build order nor InDesign warm-up could
swap the conclusion. The metric is the same as the previous measurement:
executed `try` blocks.

| | no cache | + ROLE cache | + PARAGRAPH cache |
|---|---|---|---|
| DOM touches (`try`) | **2,719** | **2,608** (−4.1%) | **2,497** (−8.2% from baseline) |
| `styleNameOf` | 790 | 716 | 679 |
| `claimParagraph` | 84 | 84 | **47** |
| output signature | 116,461.718 | 116,461.718 | 116,461.718 |

Time is given separately, in PAIRS, because it cannot be compared across
sessions — absolute numbers drift, and only a pair taken back-to-back is
comparable:

| pair (one session, one build) | A | B |
|---|---|---|
| no cache ↔ ROLE cache, median of 4 | 650 ms | **698 ms** |
| role cache ↔ + paragraph cache, median of 3 | 619 ms | **533 ms** |

Three things these numbers say:

1. **the counter is deterministic, time is not.** DOM touches reproduce to
   the exact number in every run; time within a single session drifts by
   ±20% and isn't an instrument at all for a 4% step. The 14% difference on
   the paragraph cache is visible only because it exceeds the drift and
   points the same direction in all three pairs;
2. **the output doesn't change.** The signature (sum of bounds and
   baselines of every folio frame, plus counts of literals, markers, and
   offsets) matches to the thousandth across all eight runs — the cache
   doesn't substitute anything;
3. **only the ROLE cache was kept.** The paragraph cache was rejected not
   for lack of a number but for its cost: `claimParagraph` is
   page-independent ONLY as long as the measurement records the marker's
   KIND, not its resolved value. §4.9's detectors (Task 6) ask precisely
   "which page will THIS page's marker resolve to," and the first such
   field would silently freeze the cache by `.id` across all pages. There's
   nothing to pay for this with: the pass on the book takes 3,341 ms out
   of a 120,000 ms ceiling (2.8%).

**Measured incidentally, that the skipped-master-frame counter costs
nothing:** `try` blocks before and after adding it — 2,719 vs. 2,719. Role
and style at that spot were already computed for the skip decision itself.

### `geometricBounds` vs. `resolve()` — "trap 2" narrows

Trap 2 recommended `resolve()` because an anchored frame's bounds sit in a
different coordinate system. Measured on a fixture, an anchored number
frame inside its host frame:

| Instrument | Frame bounds | Host |
|---|---|---|
| `geometricBounds` (at `SPREAD_ORIGIN`) | y 183.4–187.0, x 7.1–10.6 mm | y 183.4–197.6, x 7.1–102.3 mm |
| `resolve(SPREAD_COORDINATES)` | y −10–0, x 0–10 pt | y 124–164, x −592…−322 pt |

`geometricBounds` places the anchored frame at the host's top-left corner —
i.e. **where it actually prints**; `resolve()` returns a 10×10 pt square at
the spread's coordinate origin, i.e. it **doesn't map it at all**. For this
kind of anchoring the instruments swap roles compared to trap 2.

So the pass measures `geometricBounds` with `rulerOrigin = SPREAD_ORIGIN`.
On the book's own (non-anchored) frames, as shown above, both instruments
give **identical verdicts**, so the choice doesn't affect anything else.

Aside: `resolve()` always returns **points, origin at the spread's
center**, regardless of `app.scriptPreferences.measurementUnit`, while
`geometricBounds` returns the script settings' units, origin at the ruler.
They must not be mixed.

### The working book's ruler is `PAGE_ORIGIN`, and restoration works

The working book's `doc.viewPreferences.rulerOrigin` is **`PAGE_ORIGIN`**,
meaning the pass really must set it, not rely on the default. Also
measured: after three consecutive passes (write + restore in `finally`)
the book stayed `modified: false` — restoration leaves no trace.

### Character offset: the discrepancy reproduced on a fixture

On the working book all 91 literals have offset 0 (confirmed by
measurement: all 91 `literalOffsets` are zero), so the "string offset
instead of character offset" bug is **impossible in principle** to detect
here. On the fixture it does show up: the folio "8–9" gives characters
`["8", "EN_DASH", "9"]`, string `"8EN_DASH9"`, literal `9` at **string
position 8** and **character position 2**.

Proven by execution, not by argument: a mutant that writes `mm.index`
instead of the character offset breaks exactly one test — and does **not**
break the one prescribed by Task 3's brief (`text.slice(offset, …)` on
p. 3, where both offsets equal 0).

---

## What follows from this for the phase

### 1. Route A is dead on this book — 0 of 91

This is **not low coverage, it's zero**, and the cause is structural: the
folio is a strip rotated −90° near the outer edge, 22.7 pt from the text
column. No recomposition will change this.

**Decision: route B (`helper`) is not an option for this book, it is the
only path.** §4.7's allowance "route B may never be born" flips on the
measured data: it is **route A** that cannot be born. Tasks that build
route A have nothing to demonstrate benefit on and cannot be verified by a
run on the book.

Route A remains needed **as an eligibility branch** — the phase computes
its topology anyway, because §4.9's detectors feed on the same data.

§4.2's requirement "the helper frame's content is empty" is **checked and
safe**: an empty two-frame story doesn't hinder resolution
(Question 13b).

### 2. `route: "auto"` is buildable — but its rule is the OPPOSITE of §4.2

§4.2 assumed `auto` picks per frame in our favor. Question 9 says
otherwise: **a helper frame created later does not override the main
thread.** So the only rule consistent with the measurement is:

- the folio overlaps a main-thread frame → **route A is FORCED**, because
  a helper frame there decides nothing. If the oracle doesn't resolve on
  it — the frame is **skipped**, not rescued by the helper thread;
- the folio overlaps nothing threaded → **route B**.

**Question 9's second round strengthened this rule rather than shaking it.**
Two alternative hypotheses — "more containers wins" and "larger overlap
area wins" — were rejected by measurement: in case `U9` the helper thread
had both, sat **exactly** under the folio, and the main text only **grazed
it by 2 pt** — and the main text still won. `U9` is, literally, the
configuration the phase will create.

**Decision on Task 10: it MAY exist, and its rule is now measured, not
guessed.** But its scope should be reassessed downward: it's a two-way
branch, not a selection subsystem. On this book it **never branches even
once** — frames overlapping a thread number zero (Question 3), so `auto`
degenerates to "helper everywhere." If the plan scoped Task 10 as building
a per-frame selector, the estimate should shrink; if it's dropped
entirely, `route: "helper"` fully covers this book.

### 3. The `_folio-helper` layer must never be hidden — and this must be caught

`visible = false` mutes resolution (Question 8), `printable = false` does
not.

- create the layer with **`printable = false`, `visible = true`**;
- the `folio-marker-unbound` detector (§4.9) must treat a threaded frame on
  an **invisible layer** as unresolved — `layer.visible` is read from the
  DOM, so this is computed, not guessed;
- the tool's documentation must say plainly: **hiding the layer silently
  breaks every folio.**

### 4. §4.9's detectors are mandatory — Question 10 confirmed this by measurement

A marker with no neighbor prints its **own page**, with no blank and no
warning. Without `folio-marker-unbound` the phase would trade a detectable
defect for an undetectable one, exactly as §4.9 warns.

### 5. The measurement pass must reach a THIRD source of frames

**Neither `page.textFrames` NOR `page.allPageItems` sees un-overridden
master items** (Question 6) — a separate blind spot, not the same as
anchored frames (`allPageItems` does see those, which is exactly why
Phase 6 switched to it). In this book, hidden under it were 40 pages, the
book's running header, and **an already-finished automatic folio on three
masters**.

For Phase 7 the consequence is narrow and concrete: 91 frames is the
complete list of folios with a number that **actually print**. But this
claim rests **not** on the absence of master folios (they exist, on 29 of
91 pages, plus a running header on 40 verso pages), but on the fact that
**the `Нумерація` layer is hidden**. `masterPageItems` and `layer.visible`
must be measured explicitly — otherwise "91 is all of them" rests on luck.

### 5a. Twenty-nine sleeping duplicates — a candidate finding for §4.9

On 29 pages the manual folio was drawn **on top of** a live master item
rather than in place of it; the master one was switched off via a hidden
layer. Only one folio prints (verified by exporting three pages to PDF), so
**the book is correct today**.

But the saved document state contains a **ready-made lie behind a switch**:
one click on the `Нумерація` layer's eye icon will print a second folio of
the form "N–N" on these 29 pages — exactly the 2026-08-04 defect. It's the
same class as `folio-marker-unbound`, and the same lever as in Question 8.
Worth considering as a separate finding; it's computable from data the
phase already collects (`masterPageItems` + `layer.visible`).

### 5b. All 91 frames are ordinary, drawn from scratch; Question 16 is about PORTABILITY

**Measured: overrides in the book number ZERO** (`overridden = false` on
all 91, `overriddenMasterPageItem` invalid on every one). An earlier draft
of this subsection claimed "62 of 91 are overridden master items," and
that was wrong: 62 is the count of pages where the applied master **has no
folio at all**.

Consequences, each on its own:

1. **For THIS book, all 91 frames are ordinary document text frames.**
   Nothing about overriding is special about them, so replacing the
   literal deals with the simplest possible case. The risk Question 16 was
   meant to close never existed in this book.
2. **Question 16 remains valuable, but as a fact about PORTABILITY, not a
   description of this book.** It says: if some other edition's folios are
   overridden master items, a marker inside them will also resolve against
   a helper thread. Together with Question 13 ("a master frame cannot be
   brought to life without an override"), this gives the complete rule for
   masters — simply not needed here.
3. **The phrasing "override is a necessary condition" is dropped.** It
   rested on a miscount.

### 6. The cause of the manual numbers is understood, and it wasn't carelessness

The master folio `⟨PREVIOUS⟩–⟨AUTO⟩` **overlaps nothing** (Question 1) →
by Question 10 it prints "N–N" → this is the 2026-08-04 defect (52 folios
reading "96–96") → it was fixed **not by an override**, but by two other
actions: the master folio was switched off via the `Нумерація` layer, and
a NEW frame with a manual left-hand number was drawn on top; on 62 of the
91 pages a master with no folio at all was also used for this → this is
how the 91 literals that Phase 6 finds came to exist.

**In other words, Phase 7 isn't adding a new technique to the book — it's
finishing what the user already started on the master and couldn't
complete, for lack of exactly the helper thread.** This is the strongest
argument for route B, and the best way to phrase the phase's value to the
user.

### 6a. The "revert pages to the master" strategy — considered, and REJECTED by measurement

Question 1 uncovered a strategy the spec never considered: instead of
replacing 91 literals, add helper frames and **revert the pages to the
master folio**, which is already automatic.

*(It was first phrased as "removing 91 overrides." A later measurement
showed overrides number **zero** — all 91 frames are drawn from scratch —
so there is nothing to remove: it would mean **deleting 91 frames and
turning the `Нумерація` layer back on**. Below the strategy is described
in this, correct, form.)*

**Question 13 closes it with one number: `29-29`.** The master frame
cannot see a helper thread sitting under it on the document page, even
though the thread was created before the master was applied and the
geometry matches exactly (measured: bounds difference `[0, 0, 0, 0]`).
Bringing the master folio to life via a helper frame is **impossible**, so
there's nowhere to revert the pages to — they would get "N–N," i.e. the
2026-08-04 defect back.

An honest comparison of the two strategies, with measured costs:

| | **Literal replacement** (spec) | **Revert to master** (new) |
|---|---|---|
| does it work at all | yes — Questions 5, 9, 11, 13b | **no — Question 13** |
| what happens to the folio | literal → `PREVIOUS_PAGE_NUMBER` over the helper frame | the page reverts to the master, which prints "N–N" |
| how it's done technically | edit the text in an existing frame | **delete 91 frames + turn the `Нумерація` layer back on** |
| what's lost | nothing: character formatting is preserved (Question 11) | **all the per-instance work** — 91 frames with their own layer and position vanish without a trace |
| how many objects are touched | 91 literals + helper thread | 91 frames + a layer + helper thread |
| reversibility | one undo step (Question 12) | one undo step, but nothing but undo itself can restore the deletion |

**Even if Question 13 had come back positive, the second strategy would
still be riskier**, and the risk isn't hypothetical: the 91 frames sit on
**two different layers** (`Нумерація в сторінках` 26, `Шар 1` 65) — a
trace of manual work, meaning the pages are not identical to each other.
Deletion discards such differences silently, all at once.

For completeness: `removeOverride()` **exists and works** (Question 14),
but doesn't apply to this book — there's nothing to remove. It remains
valid for editions where the folios really are overridden master items,
and there too it discards every per-instance edit.

**Decision: the spec's strategy stands unchanged.** Literal replacement is
the only path that works.

### 7. The write costs under a second, and undoes in one step

196 frames + `saveACopy` = **1,238 ms** on the fixture, one undo step.
`saveACopy` **of the book itself** (16.07 MB) — **225 ms**, i.e. double
the fixture, not an order of magnitude.

§4.6's limits are not threatened **along the document-size axis**. Along
the "synced destination" axis, no measurement was made: the copy was
written to the system temp folder, not the book's own Google Drive folder.
The undo check in §9 must be **manual**, since `undo()` cannot be called
from the script.

### 8. Small, but costly to forget

- `ClaimParagraph` must carry the literal's **character** offset, not the
  text offset — with an honest note that on this book the trap has zero
  cases where it would fire;
- compute overlap in **one** coordinate system (`resolve()`); the
  discrepancy with `geometricBounds` is 311.81 pt on Y;
- **take the bounding box from FOUR corners.** From two it's correct only
  for multiples of 90°; for an arbitrary angle it understates the box, and
  the overlap silently disappears;
- `doc.layers.add()` makes the layer **active**: after creating a layer,
  every new frame lands on it until `itemLayer` is set explicitly;
- rotating a frame **does not affect** marker resolution (Question 15), so
  no separate `skipped` reason is needed for rotated frames — even though
  in this book all 91 are rotated.

### 9. Phase 6's note about the running header was wrong — already corrected

Phase 6, Question 5: "there is no running header with the chapter name."
The running header **does exist** — on the verso of masters `E`, `D`, `J`,
plus `C-Передмова` and `I-Зміст`. The cause of the error wasn't
carelessness but the same blind spot in the pass: `page.allPageItems`
cannot see un-overridden master items.

Corrected in commit `e3b7997` in `docs/measured-facts-phase6.md`. This
doesn't resurrect the `runningHead` family (§2 puts the running header out
of scope for Phase 7); what was corrected is exactly the **basis**, so the
next phase doesn't inherit a false fact: "there's no material" must be
read as "the measurement failed to see it."

---

## Question 20 (2026-08-08, Task 11B): does a REPEAT measurement see helper frames

**Asked because §4.5 was built on the opposite assumption.** The
`planId → chainOffsets` channel was justified this way: "helper frames
don't belong to the `folio` family, so a repeat `pagination_measure` won't
see them, and actual coverage can't be known any other way."

**Measured: half of that claim is false.** Helper frames indeed never
become CLAIM frames (wrong paragraph style, no literals). But they show up
in every one of the folio's `ClaimFrame.overlaps` — a helper frame's
geometry matches the folio EXACTLY (§4.2), so `IDMCP.boundsTouch` produces
an overlap by construction. The final review measured this on a live
document: after `create-helper-thread`, all three folios had `overlaps: 1`
with the correct `previousPage` ("2", "4", "6").

**A decisive consequence, and it's about the UNIT.** Actual coverage lives
in the measurement itself — and it lives PER FRAME, whereas `chainOffsets`
carried it PER PAGE. It is exactly this difference that C1 rested on: the
route was chosen as "there's a document overlap → `thread`," so the
`helper` branch was reachable exactly when there was NO helper frame under
the frame, and there the oracle deemed the frame eligible from the
per-page list.

### Three inputs, reproduced by the printed number (`scripts/probe-11v-printed.mjs`)

Own temporary documents, 8 facing pages, folios "N–⟨AUTO⟩" on recto.
`BEFORE` and `AFTER` — text read from the PDF via `pdfjs-dist`.

| Input | What it does | Old unit (mutant) | Per-frame unit |
|---|---|---|---|
| A | `route: "helper"` with no `planId`, no thread | `2–3` → **`3–3`**, `4–5` → **`5–5`**, `6–7` → **`7–7`**; `applied: 3` | unchanged; `applied: 0`, `no-neighbour-frame` ×3 |
| B | `route: "auto"` + `planId`, `_folio-helper` layer deleted between calls (8 elements) | same; `applied: 3` | unchanged; `applied: 0`, `no-neighbour-frame` ×3 |
| C | `route: "auto"` + `planId`, TWO folios on p. 3, no operator action | `2–3` → **`3–3`** (the neighboring `2–3B` intact); `applied: 4`, `ignoredFolioFrames: [294]` | unchanged; `applied: 3`, `no-neighbour-frame` ×1 on p. 3 |

**The "old unit" isn't a recollection, it's a run.** A mutant (defaulting
`ChainForecast` → `"contract"`) reproduced the review's numbers verbatim,
i.e. the probe DISTINGUISHES states before it claims equality between
them. Without this control, "PDF before = PDF after" would hold true even
on a broken export.

**Input C is worth reading carefully.** One of the page's two folios got a
helper frame, and it was the one LEFT WITHOUT ONE that lied — the other one
printed the correct "2." So the defect isn't that the thread doesn't
exist at all, but that a claim about the page was substituting for a claim
about the frame.
