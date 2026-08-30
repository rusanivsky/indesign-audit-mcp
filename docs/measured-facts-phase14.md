# Measured facts — Phase 14 (color and print readiness)

Probe `H14`, eight read-only passes via `indesign_run_jsx`,
**2026-08-16**, InDesign 21.5.1.73. No writes: every pass reads properties
and assigns nothing.

Documents at the time of measurement — both open, `saved: true`,
`modified: false`:

- `Book 260811-1645.indd`, 196 pages;
- `Forzats_260816_380x220.indd`, 2 pages (endpapers).

---

## 0. THE MAIN POINT: the phase's original cause was already fixed BEFORE the measurement, and there is no positive sample

The phase began because a **printed proof sheet** showed a black that
turned out to be **400%** in the layout (i.e. `100/100/100/100`). The user
found it and **fixed it by hand before the probe was ever run**.

So every number below reflects the state **AFTER the fix**. Neither
document has anything with `tac = 400`, except the built-in
`[Registration]` swatch, which **is applied to nothing**.

**Consequence for the phase, and it's a hard one: the book CANNOT serve as
a positive sample for the main detector.** Acceptance for the
"rich/multi-ink black" family rests on fixtures (`__fixture_make`) and on
the next book, not this one. This already happened in Phase 12 — a
criterion drawn from a live document has an expiration date, because the
document is alive and gets edited between the measurement and the run.
Same thing here, but caught in time.

**Second consequence:** the story "the probe found nothing" does NOT mean
"the layout is clean." It means "what was being looked for has already been
removed." These two states are distinguished only by this paragraph.

---

## 1. The palette of both documents

`Book`, `doc.swatches` — **7**:

| Swatch | Model | Space | Value | TAC |
|---|---|---|---|---|
| `None` | — | — | — | — |
| `Registration` | `REGISTRATION` | CMYK | 100/100/100/100 | **400** |
| `Paper` | `PROCESS` | CMYK | 0/0/0/0 | 0 |
| `Black` | `PROCESS` | CMYK | 0/0/0/100 | 100 |
| `C=0 M=9 Y=24 K=0` | `PROCESS` | CMYK | 0/9/24/0 | 33 |
| `C=1 M=29 Y=18 K=0` | `PROCESS` | CMYK | 1/29/18/0 | 48 |
| `C=20 M=100 Y=90 K=10` | `PROCESS` | CMYK | 20/100/90/10 | 220 |

No RGB, no Lab, no spot color, no mixed ink at all.
`doc.inks.length = 4` — exactly four inks, a 4/4 job.
`doc.gradients.length = 1` — one gradient **defined and used nowhere**.

`Forzats`, `doc.swatches` — **12**: the same `None`/`Registration`/`Paper`/
`Black`, three pure primaries (`C=100 M=0 Y=0 K=0`, `C=0 M=100 Y=0 K=0`,
`C=0 M=0 Y=100 K=0`), three composite ones (`C=15 M=100 Y=100 K=0` = 215,
`C=75 M=5 Y=100 K=0` = 180, `C=100 M=90 Y=10 K=0` = 200),
`C=0 M=29 Y=18 K=0` = 47, and `_ТЕХНІЧНИЙ (не друкується)` = `PROCESS` CMYK
100/0/0/0.

## 2. `[Registration]` is applied nowhere

Walked `allPageItems` (1128 elements) for `fillColor` and `strokeColor`,
`allParagraphStyles` (56), `allCharacterStyles` (9), `allObjectStyles` (4),
and 2417 `textStyleRanges`. **Zero uses of `[Registration]`.**

The swatch always exists in the palette — it cannot be deleted. The mere
presence of `[Registration]` in the swatch list **is not itself a
finding**, and a detector that reported it would just be reporting built-in
InDesign behavior.

## 3. Objects: 1128 elements

Fill:

| Color | Elements |
|---|---|
| `None` | 852 |
| `C=20 M=100 Y=90 K=10` | 126 |
| **unnamed** | **85** |
| `C=1 M=29 Y=18 K=0` | 20 |
| `C=0 M=9 Y=24 K=0` | 20 |
| property unavailable | 25 |

Stroke: `None` 1038, `Black` 82, `C=0 M=9 Y=24 K=0` 2, unavailable 6.

**Overprint: `overprintFill` or `overprintStroke` = `true` on ZERO
elements.** The "overprint" family has no positive sample in this book.

## 4. Unnamed colors on objects — 84 with a TAC of 260

Breaking down those same 85 unnamed fills by value:

| Space and value | TAC | Elements |
|---|---|---|
| CMYK 76/48/66/70 | **260** | **84** |
| CMYK 1/29/18/0 | 48 | 1 |

Carriers: `GraphicLine` and one `Polygon`, pages 17, 25, 33, 34, 42, 43,
50 and onward. Model — `PROCESS`.

**76/48/66/70 is a "rich black" from a typical RGB→CMYK conversion (the
Illustrator/Photoshop default black).**

> **REFUTED BY A LATER MEASUREMENT — see §12.** This originally concluded
> that this was "the same species of defect as the phase's root cause, just
> 260 instead of 400." **That's false.** All 84 carriers have ZERO AREA (82
> lines at 340.2 × 0 pt and 2 polygons at 0 × 0 pt), and a zero-area
> object's fill prints nothing. What prints is their stroke — `Black` at
> 0.4 pt, flawless. This paragraph is left as-is rather than rewritten,
> because it shows exactly how the measurement refuted a conclusion drawn
> from that same measurement one step earlier.

A second fact from this same table: **a color applied bypassing the
swatch.** The same `1/29/18/0` exists as the swatch `C=1 M=29 Y=18 K=0` and
simultaneously sits on one element unnamed. Two paths to the same color —
and the second one is invisible in the palette entirely.

## 5. Text: 575 sources, 2417 ranges

| Fill / stroke | Ranges |
|---|---|
| `Black` / `None` | 1727 |
| `C=20 M=100 Y=90 K=10` / `None` | 634 |
| `C=0 M=9 Y=24 K=0` / `None` | 52 |
| **unnamed CMYK 2/8/23/0** / `None` | **3** |
| **unnamed CMYK 0/100/85/5** / `None` | **1** |

**All black text in the book is `[Black]`, i.e. pure K.** This is correct,
and it's worth recording: if a "small text in rich black" detector had
existed yesterday, it would have returned zero on this book — and that
would have been the **truth**, not a blind spot in the instrument.

`fillTint` different from both `100` and `-1` — **on zero ranges**.

**Two findings that are live right now.** `0/100/85/5` is a near miss past
the canonical accent red `20/100/90/10`: a different red on a single range
out of 634. `2/8/23/0` (three times, in master-page text) is a near miss
past `0/9/24/0`. Both unnamed, both bypassing the palette.

## 6. Master pages are visible only to a separate walk

The document's `allPageItems` **does not include master-spread elements** —
the same trap Phase 10 already paid for on `page.textFrames`. A separate
walk over `masterSpreads`:

- fills: 120 accent, 20 `C=0 M=9 Y=24 K=0`, 20 `None`,
  1 `C=1 M=29 Y=18 K=0`, **1 unnamed `1/29/18/0`**;
- text: 17 accent, **3 unnamed `2/8/23/0`**.

So **three of the four unnamed text colors, and one of the two unnamed
swatch duplicates, live specifically on masters** — exactly where the
obvious walk never looks.

**This walk itself is incomplete too, and that's worth stating rather than
hiding.** The master walk only read `fillColor` on objects, and only the
fill on text; stroke on master objects, rules, and effects on masters were
not read at all. So the number "1 unnamed on masters" is a **lower bound**,
not a total.

This is the third instance in a single measurement of the instrument
turning out narrower than intended (first — a walk with no masters at all,
second — a walk with no styles or rules). This is exactly why the central
unit of this phase is the walker, not the rule.

## 7. Empty surfaces — detectors have nothing to stand on

On the `Book` book:

| Surface | Measured |
|---|---|
| Tables (`story.tables`) | **0** |
| Paragraph rules (`ruleAbove`/`ruleBelow` = true) | **0** |
| Underlines (`underline` = true) | **0** |
| Strikethrough (`strikeThru` = true) | **0** |
| Drop shadows (`dropShadowSettings.mode ≠ NONE`) | **0** |
| Applied gradients | **0** |
| Embedded links | **0** |

These surfaces **must be in the walker**, because the next book will have
them, but their acceptance cannot be drawn from this book. Fixtures only.

## 8. Styles: no offending color in any definition

56 paragraph styles, 9 character styles, 4 object styles. Checked
`fillColor`, `strokeColor`, `ruleAboveColor`, `ruleBelowColor`,
`underlineColor`, `strikeThroughColor`. **Zero `[Registration]` swatches,
zero with TAC ≥ 240.**

## 9. Placed graphics — opaque to a script

`allGraphics` = 6:

| Type | Link | Space | ppi | effective ppi | Page |
|---|---|---|---|---|---|
| `PDF` | `logo.ai` | **unavailable** | — | — | 3 |
| `PDF` | `logo.ai` | **unavailable** | — | — | 196 |
| `Image` | `Mother_1.psd` | CMYK | 300 | 451 | 2 |
| `Image` | `Mother_2.psd` | CMYK | 300 | 409 | 20 |
| `Image` | `Mother_3.psd` | CMYK | 300 | 414 | 96 |
| `Image` | `Mother_4.psd` | CMYK | 300 | 417 | 128 |

**This is the instrument's ceiling.** From a PSD the script can retrieve
`space`, `profile`, `actualPpi`, `effectivePpi` — and nothing else. How
much ink sits in a specific pixel of an illustration, ExtendScript doesn't
know and can't know. In an `.ai` placed as `PDF`, even `space` is
unavailable.

**Had the 400% black been inside `Mother_2.psd`, this tool would never have
found it.** The only honest behavior is to call these six placements
unmeasurable and list them, rather than staying silent.

## 10. Endpapers: an opaque color that is NOT a defect

`_ТЕХНІЧНИЙ (не друкується)` is `PROCESS` CMYK 100/0/0/0. The name promises
it doesn't print, but **InDesign has no way to make a swatch
non-printing**: only a layer can be non-printing.

Verified. All eight elements with this stroke (`Rectangle` ×6,
`GraphicLine` ×2) sit, every one of them, on the layer
`02 · ТЕХНІЧНЕ — не друкувати`, which has **`printable = false`**. The
document's layers:

| Layer | `printable` | `visible` |
|---|---|---|
| `01 · Фон` | true | true |
| `03 · СЛАГ — друкується` | true | true |
| `02 · ТЕХНІЧНЕ — не друкувати` | **false** | true |

**The file is built correctly, and that's exactly why this measurement is
valuable: it kills a class of false positives before any code is written.**
A detector that judges color without the layer would have reported eight
violations here — "100% cyan on eight objects" — and all eight would have
been false.

**So every tuple from the walker carries `layer.printable`, and that's not
decoration — it's a correctness condition.** Also worth noting: a TAC of
400 on a non-printing layer is not a defect.

---

## 11. The working book's layers — and a second defect of the same kind

Captured 2026-08-16, in a separate pass: the first eight passes never read
the book's layers at all.

| Layer | `printable` | `visible` | Elements |
|---|---|---|---|
| `Шар 1` | true | true | 760 |
| `_folio-helper` | **false** | true | **196** |
| `Червоні крапки чеклисту` | true | true | 108 |
| `Нумерація в сторінках` | true | true | 33 |
| `BG` | true | true | 22 |
| `Нумерація` | true | **false** | **6** |
| `Шар 7` | true | true | 3 |
| `Layer 8` | true | false | 0 |
| `Шар 4` | true | false | 0 |
| `Шар 6` | true | true | 0 |

**196 of 1128 elements — 17% of the document — sit on a non-printing
layer**, `_folio-helper` (the utility folio-number chain from Phase 8). The
`printable` gate, which saved eight false positives on the endpapers, saves
one hundred ninety-six here.

**And a second defect the spec didn't originally account for: `Нумерація`
has `visible = false` while `printable = true` — six elements.** A hidden
layer by default doesn't print and doesn't go into a PDF. So "doesn't
print" has TWO independent causes, and the tuple must carry both.

This is the third finding of the same kind in a row within a single phase:
first the walker turned out narrower than intended (masters, styles,
rules), then the verdict turned out wider than "prints" (non-printing
layers), now wider a second time (hidden ones). **What they share is that
none of them was found by reasoning: all three were found by measurement.**

---

## 12. Zero area — 84 false findings out of 84, and the end of the phase's headline number

Captured 2026-08-16, after §4 had called those 84 objects live candidates.
**This section refutes §4 and the positive control the plan promised.**

The probe against those same 84 objects:

| What was measured | Value |
|---|---|
| `GraphicLine` with fill 76/48/66/70 | 82, bounds **340.2 × 0 pt** |
| `Polygon` with the same fill | 2, bounds **0 × 0 pt** |
| Their stroke | `Black` (pure K), 0.4 pt |
| Their layer | `Шар 1`, printing and visible |
| Objects with fill and zero area in the WHOLE book | **84 — exactly the same ones** |
| Genuine fills (non-zero area) | 167 |
| Zero-thickness strokes | **0** |

**A line has no interior.** InDesign lets you assign it a fill, and that
fill prints nothing — under any settings. What's visible on pages 25, 33,
34, 42, 43, 50, 59, 68, 91 and onward is the 0.4 pt stroke in pure
`[Black]`, and it's flawless.

**So:**

1. A `tac-over-limit` detector would have produced **84 findings, and all
   84 would be false**.
2. An `unnamed-color` detector would have returned those same 84 plus six
   genuine ones.
3. **The working book is clean in terms of ink coverage.** The highest TAC
   among colors that actually print is 220 (accent red).

The rule born from this: a tuple carries `laysInk` — a fill is only judged
at non-zero area, a stroke only at `strokeWeight > 0`. No parameter to turn
this off: layers are about human intent, this is about physics.

**This is the third case in a single phase where the verdict turned out
wider than "prints":** §10 non-printing layers, §11 hidden ones, now
geometry.

> **CORRECTION FROM 2026-08-16, AFTER RUNNING THE BUILT TOOL.** This used to
> say "286 of 1128 elements combined — a quarter of the document." **That
> was false, twice over.** First, it conflated ELEMENTS with COLOR
> APPLICATION SITES — different units: 1128 elements yield only 477 color
> tuples, because most fills and strokes are `None`. Second, the 196
> elements on the `_folio-helper` layer **carry no color at all**, so it's
> not 196 sites skipped by the non-printing-layer gate, it's **zero**. The
> real numbers are in §13.

---

## 13. A run of the BUILT tool on the book — and three numbers it corrected

Captured 2026-08-16 at commit `488919b`, i.e. after the round of fixes from
the branch's final review. **This is the first run of the tool as a
whole**, and it refuted three numbers that had until then rested on
arithmetic rather than measurement.

### Tuples by surface

| Surface | Tuples |
|---|---|
| `textRange` | 2417 |
| `styleDefinition` | 298 |
| `pageItem` | **477** |
| `swatch` | 7 |
| `gradientStop` | 2 |
| **Total** | **3201** |

**477, not 1290.** The walker SEES 1290 elements (1128 page-level + 162
master), but only 477 produce a color tuple: for the rest, fill and stroke
are `None`. An element and a color-application site are **different
units**, and they must not be conflated.

### How many were skipped from judgment, and why

| Reason | Sites |
|---|---|
| Non-printing layer | **0** |
| Hidden layer | **12** |
| No ink laid (zero area) | **84** |
| `overprint` failed to read | **0** |
| Judged | **2872** |

**Zero on the non-printing layer is the most important correction.** The
`_folio-helper` layer really does have `printable: false` and really does
contain 196 elements (§11), but **none of them carries any color**: these
are utility text frames for folio numbers with `None` on both fill and
stroke. So the `printable` gate skips nothing on this book — not because
it's unnecessary, but because there's nothing for it to filter out. The
claim "196 sites skipped" was arithmetic derived from an element count, and
the measurement refuted it.

### Findings — five rows, ten instances, all `palette`

| Color | Instances | Where |
|---|---|---|
| unnamed CMYK `2/8/23/0` | 4 | text and style definitions; masters H, M, N |
| unnamed CMYK `1/29/18/0` | 2 | elements on master `F-Шаблон інтерв'ю` |
| unnamed CMYK `0/9/24/0` | 2 | style definitions |
| unnamed CMYK `0/93/88/0` | 1 | style definition |
| unnamed CMYK `0/0/0/0` | 1 | gradient stop |

`tac-over-limit` — **zero**. `registration-applied`, `non-cmyk`,
`spot-applied`, `rich-black-small-text`, `overprint-*` — **zero**. Response
size — **4005 B**.

**Where exactly all ten sit: master pages and STYLE DEFINITIONS.** That is
precisely the two surfaces the first, "obvious" probe pass never looked at
at all (§0, §6). The phase closed the loop on itself: the book's only real
findings sit exactly where the original instrument was blind.

New, the twelfth so far: `0/93/88/0` — one more off-palette red, this time
in a style definition, right next to the canonical `20/100/90/10`.

---

## 14. Timing on a FRESHLY LAUNCHED InDesign (Task 15)

Captured 2026-08-16 at commit `488919b`. InDesign was **quit and relaunched
fresh**, the book opened in a clean app (open time — 389 ms, all 6 links
`NORMAL`). This is the condition without which the numbers are invalid: the
rule holds for every phase.

| What was measured | Value |
|---|---|
| `color_measure` pass (the JSX itself) | **3444 ms** |
| Full round trip through the bridge | **5521 ms** |
| Response size | **4004 B** |
| Tuples | 3201 |
| Findings / instances | 5 / 10 |
| `unreadSurfaces` | **empty** |

The `seen/parsed/failed` counters — **zero `failed` on every one of twelve
surfaces**: `swatch 7/7/0`, `pageItem 1290/1290/0`, `textRange 2417/2417/0`,
`styleDefinition 72/72/0`, `effect 5160/5160/0`, `gradientStop 2/2/0`,
`link 6/6/0`, with `paragraphRule`, `underline`, `strikeThrough`,
`tableCell`, `tableStroke` all honestly `0/0/0`.

**For comparison with other heavy passes:** `geometry_measure` — 744 ms for
965 elements; `styles_measure` — 10.7 s. `color_measure` at 3.4 s across
eleven surfaces of a 196-page book falls between them.

### A positive control the phase never had on a live document until now

| Parameters | Rows / instances | What fired |
|---|---|---|
| default (limit 300) | 5 / 10 | only `unnamed-color` |
| limit 250 + near-miss threshold 25 | 10 / 20 | plus `unnamed-duplicate-of-swatch` (5) and `near-miss-of-swatch` (5) |
| **limit 200** | 6 / **893** | **`tac-over-limit` on the accent `C=20 M=100 Y=90 K=10` — 883 instances** |
| `includeHidden: true` | 5 / 10 | no change: 12 hidden sites carry colors already in the palette |

**This lifts §0's main limitation.** Until now the `tac` family was proven
only by a fixture, because after the fix the book had no overage at all. A
limit of 200 shows the detector **genuinely fires on a live document** — on
a named swatch, used 883 times, not on a definition sitting in the palette.
So both the detector itself and the "swatch ≠ usage" gate — the one the
final review found broken — actually work.

**A TAC breakdown** confirms this independently:

| Range | Sites |
|---|---|
| ≤ 100% | 1988 |
| ≤ 200% | 1 |
| ≤ 240% | **883** |
| ≤ 260%, ≤ 280%, ≤ 300%, ≤ 320%, > 320% | **0** |

The book is two populations: pure K and light tones (1988), and the accent
red at 220% (883). Above 240% there is **nothing at all**.

### The `pagination-apply` failures were degradation — proven by execution

Overnight, at the end of a five-hour session, `pagination-apply.test.ts`
produced 13 failures, all `Test timed out in 60000ms`. On a freshly
launched InDesign, the same file with no code change at all:

> `Test Files 1 passed (1)`, `Tests 18 passed (18)`, duration **109 s**.

**The full integration suite on a fresh app:**

> `Test Files 34 passed (34)`, `Tests 329 passed (329)`, duration **497 s**.

Against 3299 s in the degraded session — a **6.6x difference**, and zero
failures against thirteen. The hypothesis was confirmed by measurement, not
by reasoning.

---

## What this means for the spec

1. The main family has **no** positive sample on this book — acceptance
   rests on fixtures (§0).
2. What judges isn't the rule, it's the **walker**: an obvious loop over
   `fillColor` misses masters (§6), styles (§8), rules, tables, and shadows
   (§7).
3. Every tuple carries its layer and its `printable` state (§10).
4. The instrument's boundary runs along the edge of placed graphics, and it
   needs to be stated in the response (§9).
5. Live candidates as of today number **6**, breaking down as follows:

| Candidate | How many | Where |
|---|---|---|
| Unnamed duplicate of swatch `C=1 M=29 Y=18 K=0` | **2** | 1 in the document, 1 on a master |
| Near miss past `C=0 M=9 Y=24 K=0` (`2/8/23/0`) | **3** | master text |
| Near miss past the accent (`0/100/85/5`) | **1** | text |

   All six belong to the `palette` family. **`tac-over-limit` returns zero
   at any reasonable limit**: the highest coverage among colors that
   actually print is 220% (accent red).

   **This used to say 90, and that was a mistake.** It counted the 84
   zero-area object fills — see §12. The number "6" remains a lower bound
   for the reason named in §6 (the probe's master walk only read fills).
