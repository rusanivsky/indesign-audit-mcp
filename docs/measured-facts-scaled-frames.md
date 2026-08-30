# Measured facts: scaled frames

Run on 2026-08-05 against the working book «Book-A 260804-2119.indd»
(198 pages, 2980 paragraphs, 552 stories). Read-only, via
`indesign_run_jsx`. The scan was carried through to completion — a previous
attempt timed out in `layout_measure` and produced no result.

## Why the previous run never finished

It measured through `layout_measure` (6.7 s for 20 pages → roughly a minute
for the whole book, past the bridge's timeout). A direct probe does the
same work in **267 ms for the entire book** — about 200x cheaper, because it
performs no composition measurements. Batching is needed here not for
speed, but only so a failure in one batch doesn't take down the rest.

## Two independent detectors that agreed

**Detector 1 — proportion.** A paragraph's point size and leading, relative
to its declared style, produce the same ratio to within 1e-6 → the frame was
scaled via "Scale Text."

**Detector 2 — character `horizontalScale`.** InDesign's vertical frame
scaling is compensated by a horizontal text scale, exactly the inverse of
the ratio.

Both detectors returned **the same three stories, and no others**. The
second one additionally found a class the first is blind to (see "96%"
below).

## Three sites of scaling — not three, as it first seemed

| # | Site | Stories | Paragraphs | Ratio | `horizontalScale` | Reference |
|---|---|---|---|---|---|---|
| A | table of contents, pp. 7–11 | 38325, 38555, 38578, 38602, 38626 | 131 | 91.2141069% | 109.632164859675 | 15 / 16 |
| B | p. 47 | 64996 | 12 | 96.8578724% | 103.244060058514 | 11.5 / 16 |
| C | p. 58 | 49700 | 5 | 94.4841204% | 105.837890625001 | 11.5 / 16 and 12 / AUTO |

The inverse ratio matches `horizontalScale` exactly:
`1 / 0.91214106852671 = 1.09632164859675`, and that is precisely the value
found in the document. `vScale` = 100 everywhere: only vertical scaling was
applied.

### A correction to the previous conclusion

The handoff prompt named **three different ratios as three separate cases**,
and the third line was `[No Paragraph Style]`, 11.3381 / 11.5 = 98.592%.

This is a **wrong reference value, not a separate case**. In
`[No Paragraph Style]` the style's point size is **12, not 11.5**. Against
the correct reference:

```
11.3380944472125 / 12   = 0.94484120393437
10.8656738452453 / 11.5 = 0.94484120393437
```

The same ratio to fourteen digits — this is the same case C, the same
frame `49726`, the same story `49700`. There are **two** distinct ratios,
plus a third (A) that the previous run never saw at all.

### Why case A is the largest, and why the proportion detector missed it

131 paragraphs is the page-number column in the table of contents (frames
`38322`, `38552`, `38575`, `38598`, `38622`, 10 pt wide). Point size
13.6821160279006 against a style value of 11.5 — the first detector can't
see the proportion, because **the reference is no longer the same style**:

```
13.6821160279006 / 15 = 0.91214106852671
14.5942570964273 / 16 = 0.91214106852671
14.5942570964273 / 13.6821160279006 = 1.06666666666667 = 16 / 15
```

The numbers are consistent with the pair **15 / 16** — the style
`Заголовок 1 до інтерв'ю`, the only style in the document with a point size
of 15 (verified by walking `allParagraphStyles`). These paragraphs currently
have `Основний текст L` applied (11.5 / 16). What exactly happened over the
document's edit history can't be measured; what is measured: scaling was
applied to text with a 15/16 reference, and the style on top was later
changed without clearing the overrides.

**Lesson for the detector:** proportion against the DECLARED style only
catches cases where the style wasn't changed after scaling.
`horizontalScale ≠ 100` doesn't depend on a reference at all and is
therefore strictly stronger. The book's largest case is only caught by it.

## A separate class: exactly 96%, 19 locations

| `horizontalScale` | `vScale` | Style | Paragraphs | Stories |
|---|---|---|---|---|
| 96 | 100 | mixed | 19 | 19 |

Stories: 67694, 68540, 68593, 68645, 68715, 68838, 68887, 69055, 69161,
69209, 69362, 69411, 69510, 69561, 69631, 69723, 69819, 71756, 73605.

**This is not a scaled frame.** Frame scaling produces fractional ratios
with a dozen digits; here it's exactly 96, a round number, across 19
different stories. This is the signature of a manual technique: the text
was squeezed to make it fit. It cannot be classified as a defect — it's a
layout designer's decision.

## The `everyItem()` trap, found in our own probe

Phase 4 measured that `everyItem()` wraps **numeric** properties in an
array. Measured here: it also wraps **object** properties the same way —
`appliedParagraphStyle` and `appliedFont`. The first draft of the probe only
unwrapped numbers, and as a result:

- **392 paragraphs** got the style name `"undefined"` (`S[k].name` on an
  array);
- `appliedFont` returned `"[object Font]"` — exactly the same trap already
  named by Phase 4 for single-item access, but reached through a different
  entry point;
- the scan's blind spot doubled: **noRatio 420 → 163** after the fix.

Unwrapping has to go **by identity, not by reference**: `Style` wrappers for
the same style are different objects, so `v[i] !== v[0]` produces false
mixedness. `.id` is compared for a style, and the pair
`fontFamily|fontStyleName` for a font. 1176 wrappers unwrapped in total.

**The conclusion about scaled frames was not changed by this** — it's
backed by the `horizontalScale` detector, which never reads styles at all
and so has no exposure to this trap. This is exactly why two independent
detectors are worth their cost.

## Scan blind spots — named, not glossed over

- **163 of 2980 paragraphs (5.5%)** give the first detector no ratio:
  `Leading.AUTO` on the paragraph or the style, mixed leading. The second
  detector has no such blind spot.
- **0 tables in the document**, 0 stories with overset. These blind spots
  are empty, and this was checked.
- **A walk over frames gave 2976 paragraphs, a walk over stories gave
  2980.** The 4-paragraph difference is text off the pages (on the
  pasteboard). Not investigated.
- `page.textFrames` skips frames nested inside groups: a direct walk gave
  100 frames across the first 50 pages, a recursive walk via
  `allPageItems` gave 138. The scan uses the recursive one.
- Two running-header frames (`39017`, `65335`) are rotated −90°. The
  rotated-frame trap was already named in Phase 3; here it has no effect on
  detection.

## Four claims from the previous session — checked one by one

Measured with the same fixed probe. The document has **51 declared
paragraph styles**, of which **37 are actually applied** across 2980
paragraphs.

| Claim from the previous session | Verdict | Measured |
|---|---|---|
| `Заголовок до чеклисту`: 3 of 3 paragraphs override the same way | **correct in substance, wrong in count** | **21** paragraphs, and **21 of 21** override |
| Two spellings of the font style name in the document | **correct, but not a defect** | see below |
| `Підпункт чеклисту`: 42 paragraphs, 40 mixed on size, 41 on font | **false** | **274** paragraphs, **0** mixed |
| `[Basic Paragraph]`: 150 pt, Apple Symbols, tracking −100 | **fully confirmed** | 19 paragraphs |

### `Заголовок до чеклисту` — 21, not 3

The style declares `20 / 20`, `Bold Italic`, tracking `20`. In practice all
21 paragraphs have: font style `Semi Bold`, tracking `−10`, with the point
size at the style's own value (20, zero overrides on it). The previous
session's conclusion still holds and even strengthens: when a style is
overridden in **100%** of cases, it's the style that needs fixing, not the
paragraphs.

For contrast — `Пункт чеклисту`, 134 paragraphs: **zero overrides** across
all four properties. A style that works as intended, in the same document.

### The two font-style-name spellings are two different typefaces, not sloppiness

- `SemiBold` (no space) — typeface **Proba Pro** (`Пункт чеклисту`,
  `Підпункт чеклисту`);
- `Semi Bold` (with a space) — typeface **ZT Neue Ralewe**
  (`Заголовок до чеклисту`).

This is **not** a naming inconsistency within one typeface: different font
foundries name their styles differently, and both spellings are correct for
their respective families. It cannot be recorded as a defect. What actually
follows from this for the tool: **`fontStyle` can only be compared between
styles within the same typeface** — otherwise a future block-`S` detector
would raise a false finding on every pair of styles that use different
fonts.

### `Підпункт чеклисту` — not mixedness, but systematic overriding

274 paragraphs. Mixed on size — **0**, on font — **0**. Instead:

| Size | Typeface | Paragraphs |
|---|---|---|
| 17 | Apple Symbols | 246 |
| 11 (style value) | Proba Pro | 28 |

So 246 of 274 paragraphs (89.8%) are entirely in the symbol typeface: these
are **checklist markers, set as their own paragraphs**, not "mixed
sub-items." The numbers "42 / 40 / 41" from the previous session have
nothing to do with this style: `42` is the count of paragraphs with font
style `Semi Bold` across the entire document — a number from a different
slice entirely.

Separately: 20 paragraphs override the font style (`SemiBold` ×2, `Italic`
×18) — for the latter, the document already has its own style,
`Підпункт чеклисту Р2` (`Italic`), applied to only 6 paragraphs. Those 18
are candidates for it.

### `[Basic Paragraph]` — confirmed, and it's the same 19 locations

19 paragraphs: the style declares 11 pt, actual is **150 pt, Apple Symbols,
tracking −100**. The stories are **the same 19** that have
`horizontalScale` = 96 (67694 … 73605). So this is one and the same object:
a large decorative glyph, squeezed to 96%, sitting on the utility style
`[Basic Paragraph]`, which shouldn't appear in the layout at all.

## REFUTED: "`indesign_run_jsx` dirties the document"

The first draft of this section claimed that `run_jsx` marks the document
as modified, because `src/jsx/run.jsx:11` unconditionally wraps every
script in `IDMCP.withUndo`, and `UndoModes.ENTIRE_SCRIPT` creates a history
step. A `readOnly` parameter that would strip the wrapper was planned.

**The hypothesis is false. Measured two independent ways:**

1. **A fixture test, written BEFORE the implementation**
   (`tests/integration/run.test.ts`). `readOnly` didn't exist yet, the
   parameter was ignored, the code went through `withUndo` — and the
   document stayed `modified: false`. A control test alongside it confirms
   the flag works: a script that adds a page returns `true`.
2. **A control diagnostic on the book itself** — a full reproduction of the
   scan's reads (`everyItem()` over six properties, `allPageItems`,
   `getElements().constructor.name`, `transformValuesOf`, `overflows`,
   `allParagraphStyles`, a walk over 40 stories). After all of it —
   `modified: false`.

What actually happened: the flag flipped to `true` sometime between the
first and last probe, and I attributed that to the probes. The book was
open in the user's session **the whole time, being worked on**, and the
user themself could have set the flag. This was **correlation mistaken for
causation** — exactly the mistake this project warns against elsewhere.

`readOnly` was not added: there is no grounds for it. What remains is a
regression test for the property we now rely on — a read-only script does
not dirty the document.

**Incidentally measured, minor, but it cost two runs:**

- ExtendScript `new File("/tmp/…")` and `new File("/private/tmp/…")` fail
  with "Cannot find the folder": the first path component is read as a
  **volume name**. The working idiom is concatenation with `Folder.temp`.
- `doc.save(File)` **renames** the document: "Untitled-N" becomes the file
  name. A test that didn't account for this left the fixture open in the
  user's InDesign, because `closeFixtureDoc` was looking it up by the old
  name.

## A decision for the user, not the model

What to do about cases A, B, C is **not a decision for the model**. The
tool finds the location and names the ratio; whether to restore the point
size to the style's value, or leave it as-is (the text was scaled to make
it fit), is decided by a human looking at the document. The same applies to
the 96% cases in 19 locations.
