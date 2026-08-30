# Measured facts — Phase 5 (H5)

Date: 2026-08-05. InDesign 21.4.1.4 (`Adobe InDesign 2026`). Document:
**«Book-A 260805-2200.indd»** — the same working manuscript as in Phases 2–4,
a newer save. 198 pages, 550 stories, 2982 paragraphs, 51 paragraph styles,
8 character styles. Exactly **one** document was open in InDesign, and the user was
**working in it during the run** — the probe is read-only, no mutating operation.

**The document name here is a measurement, not a condition.** The probe measures
`app.activeDocument`, whichever it is; the name is recorded so the numbers can be
reproduced, not so anything depends on it.

**How it was run.** Five runs through `runJsx("run_script", …)` from the **built
branch** (`npm run build`, then `node`), and **not** through the `mcp__indesign__*`
MCP tools: the server was started from the main repo directory and would have silently
served the old build. The handler is `src/jsx/run.jsx` (`eval` of the body inside
`withNoInteraction` + `withUndo`, result from the `__result` variable); `map.jsx` loads
together with the rest of the core, so `IDMCP.declaredStyleValues`,
`IDMCP.charPropActual`, and `IDMCP.propValue` are available inside the body.

**Probes** (all outside the repository, in the session scratchpad; not committed):

| Run | What it measured | Time |
|---|---|---|
| `h5-pre` | document state, application version, basic counters | 321 ms |
| `h5-probe` (briefing text, transcribed) | Questions 1–7 as phrased in the briefing + scale | 8402 ms |
| `h5-probe2` | `appliedFont` type by style class; `basedOn` **by id**; Question 2 as-is; layout | 4331 ms |
| `h5-probe3` | paragraph style usage **by id** (name collision); breakdown of deviations; what a character style returns on an unset property | 2327 ms |
| `h5-probe4` | twins with the same name; scale by ranges vs. by paragraphs | 1640 ms |
| `h5-probe5` | a realistic pass of Task 2's form (13 fields per paragraph) | 3790 ms |
| `h5-probe6` | declared `horizontalScale` across all 51 paragraph and 8 character styles — the blind zone from Question 2, bounded (added on review) | 368 ms |

Two corrections to the briefing text, both **additive**, neither removes an already
accounted-for pitfall:

1. `appliedFontFamily` was added next to `String(appliedFont)` for every character
   style — this exact pair is what disproved rule §7.4 (below, Question 3);
2. Question 2 was measured **twice**: first literally per the briefing (counting
   ranges with `[None]`), then by comparing against the declared paragraph style
   values. The first measurement gave 3137, the second — 449. The difference is
   explained in Question 2 and is this probe's main refutation.

## `doc.modified` — and why `false → true` here proves nothing

| Run | `modified` on entry | on exit |
|---|---|---|
| `h5-probe` | `false` | `false` |
| `h5-probe2` | `false` | `false` |
| `h5-probe3` | `false` | `false` |
| `h5-probe4` | `false` | `false` |
| `h5-probe5` | **`true`** | **`true`** |
| `h5-probe6` (on review) | **`true`** | **`true`** |

The flag flipped **between** the fourth and fifth runs — in a window where none of our
calls went to InDesign (local `node -e` calls over an already-saved JSON were running
at that time instead). The book was open for the user, and they were working in it.

**The proof that actually exists here:** in each of the six runs, the value on entry
equals the value on exit — including the heaviest one (`h5-probe5`: 2982 paragraphs ×
13 fields, 6 of them through `charPropActual`, i.e. a full traversal of
`textStyleRanges`). The read-only path, wrapped in `withUndo`, does not set the flag:
this is shown **four times** at `false→false` and **twice** at `true→true`. Between
runs, the flag moved on its own in both directions (`false→true` before `h5-probe5`,
`true→false` after it, `true` again before `h5-probe6`) — i.e. it moved at times when
none of our calls went to InDesign.

**The proof that does NOT exist here:** a control run on a fixture was not done.
Creating a document while the user is working in InDesign is an unnecessary risk for a
number that already has five consistent observations. This is a deliberate choice of
"don't touch the document" over "push the measurement further" (the same trap already
fallen into once: `docs/виміряні-факти-масштабовані-рамки.md`, the "DISPROVEN"
section).

Structural counters before and after the flag flip did not change: 550 stories,
51 paragraph styles, 8 character styles, 198 pages.

---

## Question 1: how many character styles are declared, how many are used, on how many ranges

**Method.** `doc.allCharacterStyles` for the declared count. For usage — traversing
`stories → paragraphs → textStyleRanges`, counting by `appliedCharacterStyle.name`.

**Raw numbers:**

```
character styles declared: 8 (of which [None] is built-in, so 7 user-defined)
textStyleRanges total: 3480
  with a character style: 343 (9.86%)
  with [None]:           3137 (90.14%)
paragraphs: 2982
```

| Character style | id | Ranges |
|---|---|---|
| Text Semi Bold | 26667 | 160 |
| Номер питання | 31735 | 152 |
| Text Regular | 26676 | 16 |
| Text Semi Bold Red | 26172 | 12 |
| Text Regular Black | 26173 | 3 |
| Text Semi Bold Italic | 39319 | **0** |
| Імпортований стиль списку Word1 | 27052 | **0** |
| `[None]` | 125 | 3137 |

**Conclusion.** 7 user-defined styles declared, **5** used, **2** unused. The
"declared ≠ used" gap reproduces at the character level the same way it does at the
paragraph level (51 vs. 37 — see Question 6), so the `style-unused` detector makes
sense here too.

**Control number for paragraph styles, counted by `id` rather than by name:** 51
declared, **37** used. Matches the earlier scan of a different save (51/37) — zero
discrepancy.

---

## Question 2: ranges with local formatting WITHOUT a character style

**Method, measurement 1 (literally per the briefing).** Count of ranges where
`appliedCharacterStyle.name === "[None]"`.

```
runs.bare = 3137 of 3480 (90.14%)
```

**Method, measurement 2 (the same traversal, but with a baseline).** For every range
with `[None]` — comparison against a baseline. The baselines are **not the same for
all five properties**, and this needs to be stated precisely, because it determines
exactly what Task 2 will need to reproduce:

| Property | Baseline actually compared against | Tolerance |
|---|---|---|
| `pointSize` | `IDMCP.declaredStyleValues(para.appliedParagraphStyle).pointSize` | 0.01 |
| `appliedFont.fontFamily` | `…declaredStyleValues(…).appliedFont` | exact string match |
| `fontStyle` | `…declaredStyleValues(…).fontStyle` | exact string match |
| `tracking` | `…declaredStyleValues(…).tracking` | 0.01 |
| `horizontalScale` | **the literal `100`, NOT the style's value** | 0.0001 |

Reason for the discrepancy: `IDMCP.declaredStyleValues` (`src/jsx/map.jsx:83–98`)
returns exactly 12 fields, and `horizontalScale` is not among them — `grep
horizontalScale src/jsx/*.jsx` gives zero hits in any of the seven core modules. The
probe could not take the declared value from there and compared against a neutral
100 instead.

The 0.0001 tolerance for `horizontalScale` is because the measured values have 12
significant digits (see "Side measurement"); for the rest of the numeric properties,
0.01.

### The blind spot of this method — named and bounded by a number

Comparing against 100 instead of the declared value produces a **false "local
deviation" on every range of a paragraph whose paragraph style itself declares
`horizontalScale ≠ 100`**. The size of this zone was measured by a separate read-only
run (`h5-probe6`, `style.horizontalScale` across all 51 paragraph and 8 character
styles):

```
paragraph styles with declared horizontalScale === 100:      50 of 51
paragraph styles with declared horizontalScale !== 100:       1 of 51
    «Чеклист 2» #32166 → 115.793814432999
paragraphs applying this style directly:                      0
character styles with declared horizontalScale:               1 of 8
    «Імпортований стиль списку Word1» → 100 (the other 7 are NOTHING)
```

**So on this book the zone is empty in its consequences, but not empty in
principle.** A style capable of corrupting the measurement exists (1 of 51), it's
just not applied to any paragraph — so none of the 3480 ranges passed through it,
and **the number 449 and its `horizontalScale = 32` component are not distorted**:
all 32 are ranges whose paragraph style declares exactly 100, i.e. genuine local
overrides. The two methods agree on this data **by coincidence**, not by
construction.

**Consequence for Task 2.** A "matches the document" implementation will get a
different number the moment a book turns up where a style with `horizontalScale ≠
100` is actually used. One of two steps is mandatory, and the choice is deliberately
left to Task 2, not to this probe:

1. add `horizontalScale` to `IDMCP.declaredStyleValues` — this is a change to
   **existing** Phase 4 code (`declaredStyleValues` feeds `document_map`), so it
   drags along test updates and a response-size check; **or**
2. keep 100 as the baseline **deliberately**, and record this in the `scale` family's
   contract as "local is defined as a deviation from the neutral 100, not from the
   style" — then a style that scales itself gives N findings by design, and that
   should be visible in the family's description rather than surface as a surprise.

This probe did (2) **unintentionally** — which is exactly why this point is named
here.

**Raw numbers, measurement 2:**

```
bare ranges total:                  3137
  actually deviate from the style:   449  (14.31% of bare; 12.90% of all 3480)
  match the style exactly:          2688  (85.69%)
deviation by property (a range can deviate on more than one):
  pointSize        356
  fontFamily       343
  fontStyle         91
  tracking          42
  horizontalScale   32
paragraphs with more than one range:    485 of 2982 (16.26%)
paragraphs with exactly one range:     2497
read errors across 3480 ranges:           0
```

Largest individual cases (in the format "declared → actual"):

| Count | Paragraph style | Font family | Point size |
|---|---|---|---|
| 246 | Підпункт чеклисту | Proba Pro → **Apple Symbols** | 11 → 17 |
| 33 | `[No Paragraph Style]` | Minion Pro → Proba Pro | 12 → 11.5 |
| 19 | `[Basic Paragraph]` | Proba Pro → **Apple Symbols** | 11 → 150 |
| 12 | Питання в інтерв'ю | Proba Pro → Times New Roman | 14 → 11.5 |
| 11 | Основний текст L | Proba Pro → Times New Roman | 11.5 → 14 |

**Can local be told apart from style-based?** Yes, and it is measured: 3480 ranges
passed through with **zero** read errors, the baseline coming from the paragraph
style via the already-existing `IDMCP.declaredStyleValues`. No separate "this is
local" API is needed.

### DISPROVEN: "bare range" ≠ "local formatting"

The briefing's phrasing (`runs.bare`) gives **3137 (90.14%)**. Read as the answer to
Question 2, this would mean "the whole book is locally reformatted" — and any
detector built on this number would highlight 90% of the text.

The truth: **449 ranges (12.90%)**. The remaining 2688 bare ranges are ordinary text
that matches its paragraph style exactly; it enters the count only because `[None]`
is itself a value of `appliedCharacterStyle`, not the absence of one.

Why the number is large at all: there are only 498 more ranges (3480) than paragraphs
(2982), and **2497 of 2982 paragraphs contain exactly one range**. So
`textStyleRanges` returns one range per paragraph by default even where no
formatting at all has been applied.

**Consequence for Task 2 and the `character` family:** what must be counted is
**deviations**, not ranges with `[None]`. The number that should reach the report is
449, and it must be broken down by property.

---

## Question 3: does a character style have a declared value, and what does `[None]` return

**Method.** Reading `pointSize`, `appliedFont`, `fontStyle`, `tracking`,
`horizontalScale`, `leading` from each of the 8 character styles — via `String(...)`,
via `typeof`, via `.constructor.name`, via `IDMCP.propValue`, and (separately) via a
direct comparison against `NothingEnum.NOTHING`.

**Raw numbers:**

```
[None]:            pointSize "NOTHING"  fontStyle "NOTHING"  tracking "NOTHING"
                   horizontalScale "NOTHING"  leading "NOTHING"  appliedFont ""
Номер питання:     pointSize "25"       fontStyle "Semi Bold Italic"  appliedFont "ZT Neue Ralewe"
Text Semi Bold:    pointSize "NOTHING"  fontStyle "SemiBold"          appliedFont ""
Text Semi Bold Red:pointSize "NOTHING"  fontStyle "SemiBold"          appliedFont ""
Text Regular:      pointSize "NOTHING"  fontStyle "Regular"           appliedFont ""
Text Regular Black:pointSize "NOTHING"  fontStyle "NOTHING"           appliedFont ""
Text Semi Bold Italic: pointSize "NOTHING"  fontStyle "Semi Bold Italic"  tracking "-10"
Імпортований стиль списку Word1: everything "NOTHING", except horizontalScale "100"

typeof [None].pointSize                     → "object"
String([None].pointSize)                    → "NOTHING"
IDMCP.propValue([None].pointSize)           → null
IDMCP.propValue("Text Semi Bold".pointSize) → null
```

**Conclusion.** A character style does **not** have a declared value in the sense a
paragraph style does. A paragraph style always declares **all** 12 properties (even
`[No Paragraph Style]` — 12 pt, Minion Pro, LEFT_ALIGN, AUTO). A character style
declares **only what is explicitly set on it**, and everything else reads as
`NothingEnum.NOTHING`.

Of the 5 used character styles:
- a full baseline (size + font family + weight/style) exists for **1** — «Номер
  питання»;
- weight/style only — **3**;
- none of the comparable properties — **1** («Text Regular Black»: everything
  NOTHING).

`[None]` returns nothing: all numeric properties are `NOTHING`, `appliedFont` is an
**empty string**, not `undefined` and not an exception.

**Consequence:** the character family **cannot** be built on "deviation from the
character style's declared value" — a baseline simply does not exist in 4 of 5 cases.
Its baseline is the same paragraph style (as in Question 2), and the character level
itself provides an **inventory** (declared/used/on how many ranges) plus a deviation
count.

`IDMCP.propValue` already returns `null` for `NOTHING` — it does not need fixing.

### DISPROVEN: a character style's `appliedFont` is a STRING, not a `Font`

Spec rule §7.4 ("`appliedFont` without `.fontFamily` gives `"[object Font]"` for any
font") **does not hold for character styles** — there it is exactly the opposite:

| Style class | `typeof` | `constructor.name` | `String(appliedFont)` | `.fontFamily` |
|---|---|---|---|---|
| character («Номер питання») | `"string"` | `String` | `"ZT Neue Ralewe"` ✅ | `"undefined"` ❌ |
| character (`[None]`) | `"string"` | `String` | `""` | `"undefined"` |
| paragraph (`[No Paragraph Style]`) | `"object"` | `Font` | `"[object Font]"` ❌ | `"Minion Pro"` ✅ |
| paragraph (`[Basic Paragraph]`) | `"object"` | `Font` | `"[object Font]"` ❌ | `"Proba Pro"` ✅ |
| paragraph («УДК») | `"object"` | `Font` | `"[object Font]"` ❌ | `"Proba Pro"` ✅ |

Checked across all 8 character and 3 paragraph styles: **8 of 8** character styles
give a string, **3 of 3** paragraph styles give a `Font` object.

**Consequence:** `IDMCP.fontFamilyName`, applied to a character style "as is," will
return `undefined` for **every** font. The `character` family must have its own font
unwrapping that accepts both forms (`typeof v === "string" ? v : v.fontFamily`),
otherwise the font-family column will be empty across the whole inventory — and
empty **silently**, since there is no exception.

### DISPROVEN (partially): comparing against `NothingEnum` on read

The recorded rule: "comparing against `NothingEnum` on READ is always false; check
via `String(...)` instead." Measured:

```
[None].pointSize === NothingEnum.NOTHING  →  true
```

So for an unset numeric property of a **character** style, identity comparison
works. The rule in this form is not universal.

**The recommendation stands despite the disproof:** go through `String(...)` /
`IDMCP.propValue`. Identity is confirmed for exactly one class of properties on one
document; there is no basis for extending it to the rest, and `propValue` already
gives `null` without any assumption.

---

## Question 4: `basedOn` and `nextStyle` — chains and breaks

**Method.** For each of the 51 paragraph styles — `basedOn.id`, `basedOn.name`,
`String(basedOn)`, `nextStyle.id`, `nextStyle.name`. Chain depth was counted in
TypeScript **by id**, with cycle protection.

**Raw numbers:**

```
styles total: 51
  without basedOn (roots):       15
  with basedOn:                   36
chain-depth distribution:
  0 levels: 15
  1 level:  13
  2 levels:  8
  3 levels: 14
  4 levels:  1
maximum depth: 4
deeper than one level: 23 styles of 51 (45.1%)
```

The deepest chain:

```
Зміст Цифра#38352 → Зміст Розділ#38228 → Основний текст L#32513
  → Основний текст F#32510 → [Basic Paragraph]#129
```

**Breaks — two different kinds, both measured:**

1. `[No Paragraph Style]#126` — accessing `.basedOn` **throws an exception**:
   `"Invalid request on a root style."` 1 style of 51.
2. `[Basic Paragraph]#129` — `.basedOn` **does not throw** anything, returns
   `[No Paragraph Style]`, but `String(basedOn.id)` and `String(basedOn.name)` both
   give the string `"undefined"`. So "there is no root" is not detected by an
   exception or by `=== null`, but only via `String(...) === "undefined"`.
   `String(basedOn)` in this case gives `"[No Paragraph Style]"` — i.e. the object
   **does exist**, it just has no id or name.

`basedOn` pointing outside `allParagraphStyles`: **0** (the only "out of bounds" case
is the exception on the root style, point 1).

**`nextStyle` — almost no signal:**

```
nextStyle === the style itself:  47 of 51
nextStyle throws an exception:    1 ([No Paragraph Style])
nextStyle.id → "undefined":       1 (Основний текст F)
nextStyle → a different style:    2 (heading 3 → Normal, heading 4 → Normal)
```

**Conclusion.** Inheritance in this book is **real and deep** — 23 styles deeper than
one level, maximum 4. `nextStyle`, on the other hand, almost always points to itself
(the typical default value) and is not a good source of findings: 2 meaningful cases
out of 51.

---

## Question 5: twin styles

**Method.** Grouping the 51 paragraph styles by the full string key
`IDMCP.declaredStyleValues(style)` (12 properties).

**Raw numbers:** 2 twin groups.

| Group | Styles (id) | Declared | Used (paragraphs) |
|---|---|---|---|
| 1 | Колонтитул v1#37670, Колонтитул v2#37671, Нумерація сторінок#25472 | 10 pt, Proba Pro Regular, CENTER_ALIGN, leading AUTO, all indents 0 | 105 / 3 / 4 |
| 2 | Основний текст L#32513, Основний текст C#47437 | 11.5 pt, leading 16, LEFT_JUSTIFIED, Proba Pro Regular, all indents 0 | 565 / 0 |

**A CAVEAT that must be stated right here.** Group 2 is a style with "L" and a style
with "C" in the name, and **both** declare `LEFT_JUSTIFIED`. Either the book really
does have two identical styles with different names, or the 12 properties of
`declaredStyleValues` **do not cover what actually distinguishes these two styles**
(for example, hyphenation settings, the composer, baseline grid, or
`alignToBaseline` — none of these are in the measured set).

So the measured claim is not "the book has 2 twin groups," but exactly this:

> **under the subset of 12 properties this project already knows how to read,
> 5 of 51 styles are indistinguishable.**

A twin detector built on this set will produce at least one suspected false positive
on this book. That's not a reason not to build it — it's a reason to phrase the
finding as "indistinguishable across N measured properties," listing those N in the
report itself, rather than as "duplicates."

---

## Question 6: identical style names in different folders

**Method.** Grouping the 51 styles by `name`; for each group — id and `parent.name`.
Checked twice, in two independent runs (`h5-probe`, `h5-probe2`) — same result.

**Raw numbers:**

```
folders: 2
  "Стилі книги":                       34 styles
  document root:                       17 styles
name collisions: 1
```

| Name | id | Folder | firstLineIndent | pointSize | justification | basedOn | Used |
|---|---|---|---|---|---|---|---|
| Основний текст L | **32513** | Стилі книги | 0 | 11.5 | LEFT_JUSTIFIED | Основний текст F#32510 | **565** |
| Основний текст L | **26178** | document root | **5.82** | **12** | **LEFT_ALIGN** | Основний текст#24182 | **0** |

**This is not a duplicate.** The two styles with the same name diverge on three of
the twelve declared properties and have different parents.

**The cost of keying by name — measured, not hypothetical, and it's twofold:**

1. **The report.** Counting usage by name gives `"Основний текст L" → 565`; counting
   by id gives `32513 → 565` and `26178 → 0`. A report keyed by name would produce
   **one** row instead of two, and style #26178 — genuinely unused — would
   **disappear from the report entirely**. Phase 4's `style-unused` detector would
   silently miss it.
2. **Hierarchy.** `basedOn` with the name "Основний текст L" is declared by **6
   styles**. Five (Анотаця, Логотип, Зміст Розділ, Зміст Підрозділ, Зміст Пункти)
   point to #32513; the sixth — **Чеклист 2** — points to **#26178**. So one and the
   same name in `basedOn` leads to two different styles. Resolving chains by name on
   this book is **demonstrably wrong in at least 1 of 6 cases**.

**Conclusion.** Spec rule §7.3 fired on real data. The report's key becomes `id`;
this is a change that touches **existing Phase 4 code**, not only new code.

---

## Question 7: the cost of the paragraph pass by itself

**Method.** Three different passes, each with its own timestamps inside ExtendScript
(`new Date().getTime()`), plus end-to-end time across the bridge from Node.

**Raw numbers:**

| Pass | What it reads | Paragraphs | ms in script | ms end-to-end |
|---|---|---|---|---|
| "bare" `everyItem()` | pointSize + appliedFont + appliedParagraphStyle, 550 stories | 2982 | **1379** | — |
| `textStyleRanges` traversal | character style name on each of 3480 ranges | 2982 | **3438** | — |
| `horizontalScale` via `charPropActual` | 1 field, accounting for mixedness | 2982 | **2918** | — |
| **realistic pass of Task 2's form** | 13 fields per paragraph (7 direct + 6 via `charPropActual`) | 2982 | **3353** | **3790** |

Derived:

```
realistic pass:       3353 / 2982 = 1.124 ms per paragraph
bare everyItem():     1379 / 2982 = 0.462 ms per paragraph
bridge overhead:      3790 − 3353 = 437 ms
volume over the bridge: ~429 KB for 2982 rows (~144 B/row)
```

**Comparison with `layout_measure`** (numbers from spec §4.6): ~36,000 ms baseline
for **any** call, 340,000 ms for the full book.

```
3790 ms vs. 36,000 ms baseline → 9.5× cheaper than the baseline alone
3790 ms vs. 340,000 ms full call → 89.7× cheaper than the full call
```

**Conclusion for the §4.6 fork.** The expense of `layout_measure` is **not** in the
paragraph pass: the whole paragraph pass in Task 2's full form costs 3.8 s
end-to-end, i.e. roughly **a tenth** of what `layout_measure` spends before it even
starts measuring. The duplication is not imaginary (option 3 of §4.6 is ruled out),
but it isn't expensive either: a dedicated paragraph pass in `styles.jsx` (option 1)
adds ~3.8 s to the tool's cost, while extracting a shared mode with `layout_measure`
(option 2) would save less than the refactor itself would cost.

**Volume** (~429 KB) is the same class as `document_map`'s 459 KB. It crosses **only
the bridge**; aggregation to the style level happens in TypeScript, and what goes out
is a report the size of a few dozen styles. Phase 4's rule "check the response
VOLUME, not just its content" remains in force for Task 7.

---

## Side measurement: `horizontalScale` (input to Task 4)

Not one of the seven questions — but the briefing measured it, and the number
changes the shape of Task 4.

**Raw numbers:**

```
paragraphs with scale ≠ 100 (via charPropActual): 162
ranges with scale ≠ 100:                          164
paragraphs with MIXED scale within the paragraph:    1
```

| Value | Ranges total | Of them bare | Of them under a character style |
|---|---|---|---|
| 96 | 19 | 19 | — |
| 109.632164859675 | 131 | 0 | **131 — «Номер питання»** |
| 105.837890625001 | 7 | 6 | 1 — «Text Semi Bold» |
| 103.244060058514 | 7 | 7 | — |

**Two consequences for Task 4:**

1. **80% of scaled text (131 of 164) sits under a character style**, not in bare
   local formatting. A detector that only looks at bare ranges would see 32 of 164
   cases — i.e. 19.5%. The `scale` family must walk **all** ranges, regardless of
   `appliedCharacterStyle`.
2. **The group key is the exact value.** Four values, three of them with 12
   significant digits. Rounding to an integer would give 96/110/106/103 (still
   distinguishable), but rounding to 0.1 would merge `105.837890625001` with
   `105.8…` of any other origin, and rounding to an integer is already a false basis:
   the difference between `105.837890625001` and `103.244060058514` is a different
   act of scaling, not noise. The key remains the string form of the exact value.

The one paragraph with mixed `horizontalScale` is exactly the case where
`charPropActual` honestly returns `null`; because of it the count by paragraphs (162)
and by ranges (164) diverge, and neither of the two is "more correct" — they measure
different things.

---

## Side measurement: paragraphs off any page (rule §7.8)

```
stories:              550
text containers:      652
containers without parentPage:  0
stories with no container at all: 0
paragraphs in placed stories: 2982
paragraphs off pages:             0
```

**This does not disprove rule §7.8.** The rule was born from a measurement of 2980
vs. 2976 on **a different save** of this book; on the 260805-2200 save, text on the
pasteboard has simply been cleaned up. Traversal by stories and by frames give the
same number here, and the script should still report how many paragraphs are off
pages — it's just that on this data the answer is zero.

---

## Drift against the previous scan

The previous scan of a different save, for comparison — a **reference point, not an
expectation**:

| Value | Previous scan | H5 (260805-2200) | Delta |
|---|---|---|---|
| Paragraph styles declared | 51 | 51 | 0 |
| Paragraph styles used | 37 | 37 | 0 |
| Paragraphs | 2980 | 2982 | +2 |
| Stories | 552 | 550 | −2 |
| Paragraphs off pages | 4 | 0 | −4 |

Deltas at this scale are a normal consequence of the user having worked on the book
since then; none of them is a finding.

---

## Summary: what got an answer, what did not

| Question | Answered | Caveat |
|---|---|---|
| 1. Character styles: declared / used / ranges | **Yes, fully** — 8 declared (7 user-defined), 5 used, 343 ranges | — |
| 2. Local formatting without a character style | **Yes, fully** — 449 of 3480 ranges, broken down by 5 properties | The briefing's phrasing (3137) is disproven; deviations must be counted, not `[None]`. **The `horizontalScale = 32` component stands on a different baseline** (the literal 100, since `declaredStyleValues` doesn't have this field) — the blind spot is named and bounded: 1 style of 51 declares ≠ 100, used 0 times, so 449 is not distorted |
| 3. Character style baseline; what `[None]` returns | **Yes, fully** — no baseline in the paragraph sense exists; `[None]` returns `NOTHING`/`""` | Two spec rules disproven (see below); the `character` family is built on the paragraph baseline |
| 4. `basedOn` / `nextStyle` | **Yes, fully** — 23 of 51 deeper than one level, maximum 4; two different kinds of breaks | `nextStyle` is not a good source of findings: 2 meaningful cases of 51 |
| 5. Twins | **Yes, with a caveat** — 2 groups, 5 of 51 styles | Indistinguishability is measured across 12 properties, not the full set; group 2 is a likely false positive |
| 6. Name collisions | **Yes, fully** — 1 collision, both costs measured (report and `basedOn`) | — |
| 7. Cost of the paragraph pass | **Yes, fully** — 3353 ms in script, 3790 ms end-to-end, ~429 KB | — |

**Task 1's gate is not blocked**: all seven questions got a numeric answer; the one
substantive caveat is on Question 5, and it is named as a requirement for how the
finding is phrased, not as a gap.

### List of disproven claims

| What was disproven | Where it's recorded | By what |
|---|---|---|
| "`runs.bare` is the ranges with local formatting" | Task 1's briefing text | 3137 bare vs. 449 with a real deviation |
| "`appliedFont` without `.fontFamily` gives `[object Font]` for any font" | spec §7.4 | for a character style, `appliedFont` is a **string**; `.fontFamily` there gives `undefined` (8 of 8 styles) |
| "comparing against `NothingEnum` on read is always false" | Task 1 context | `[None].pointSize === NothingEnum.NOTHING` → `true` |
| "a character style has a declared value the same way a paragraph style does" | an assumption Question 3 was testing | 4 of 5 used styles have no full baseline; `[None]` has none at all |
| "the expense of `layout_measure` might be in the paragraph pass" (option 3, §4.6) | spec §4.6 | the full paragraph pass — 3790 ms vs. `layout_measure`'s 36,000 ms baseline |
| "`false → true` in `doc.modified` means the probe is dirtying the document" | a trap named by the briefing | the flag flipped between runs, outside the window of our calls; within each of the 5 runs, entry === exit |
| "all five properties of Question 2 were measured against `declaredStyleValues`" | **the first edition of this very document**, retracted on review | `grep horizontalScale src/jsx/*.jsx` — 0 hits across 7 modules; `declaredStyleValues` has exactly 12 fields, `horizontalScale` is not among them. Its baseline was the literal 100 |

**Not disproven, confirmed:** rule §7.3 ("a style name may not be unique") — exactly
1 collision found, and it has two measured costs; rule §7.5 (`Leading.AUTO` is an
enum) — `declaredStyleValues` returned `"AUTO"` for 3 styles; rule §7.6 (mixedness is
determined by traversing `textStyleRanges`) — 1 paragraph with mixed
`horizontalScale` was found exactly this way.

---

## Run of the finished tool (Task 10)

Date: 2026-08-06. A run of the BUILT `styles_audit` tool (not a probe) through
`runJsx` from the built branch (`npm run build`, then `node`), not through
`mcp__indesign__*` — the same trick as the rest of the phase: the MCP server was
started from the main directory and would have silently served the old build.

**The document is a measurement, not a condition.** The tool measured
`app.activeDocument`, whichever was open; the name is recorded below so the run can
be reproduced, not because the tool depends on it (`DEFAULT_STYLE_NAMES` are
InDesign's built-in styles, not this book's own).

- `docName`: **«Book-A 260805-2200.indd»**
- pages: **198**
- `doc.modified` before measurement: **false**; after measurement: **false**

The "false → false" match here is consistent with the measurement having changed
nothing, but it does not prove that by itself: the user could have saved the book in
parallel between the two status reads, and `false → false` would look the same. We
are not conflating correlation with cause here — the same lesson already named in the
`doc.modified` section above.

### Question 1: `styles_measure` timing

| What | Value |
|---|---|
| full-measurement time (`styles_measure`, 198 pages) | **10,860 ms (10.9 s)** |
| ceiling `STYLES_MEASURE_TIMEOUT_MS` | 120,000 ms |
| half the ceiling | 60,000 ms |
| measured time relative to the ceiling | ≈9% |

The measured time does NOT exceed half the ceiling — no user decision is needed, the
constant remains `120_000`, and the comment next to it now names this number instead
of "no real number exists" (fixed in `src/tools/styles.ts`).

### Question 2: `styles_audit` response volume in bytes

The tool's EXACT response was reconstructed (all 5 families, `ok()` serialization
`JSON.stringify(data, null, 2)`) on the cached measurement — without a second call to
InDesign, using the same code as `src/tools/styles.ts:272-628` (`buildReport`,
`detectUsage`, `detectScale`/`detectRatioScale`/`groupScales`, `detectCharacter`,
`detectHierarchy`/`resolveChainsDetailed`).

| Call | 9 pages (fixture, `tests/integration/styles-audit.test.ts`) | 198 pages (Task 10) | Growth |
|---|---|---|---|
| without `detail` | 10,774 B | **48,411 B** | ×4.5 |
| with `detail` for the largest family | 13,267 B | **69,743 B** | ×5.3 |

The "largest family" was determined by measurement: among `overrides` (largest key
`styleId 32513 + group justification` — 133 entries), `scale` (`styleId 32513` — 134
entries), `character` (`styleId 32513` — **543** range+property pairs), `usage`
(`styleId 126` — 46 entries), the largest is `character`, `styleId 32513` («Основний
текст L», the same style that also appears in the name collision). The response with
this `detail` is truncated by the `MAX_DETAIL_ITEMS = 50` ceiling:
`detailTruncated: { shown: 50, total: 543 }`.

The growth in volume is NOT proportional to the growth in pages (198 / 9 ≈ ×22): the
response scales with the number of STYLES and REPORT ROWS (51 styles regardless of
page count), not directly with pages, and the `detail` ceiling (50 entries) keeps the
second call from growing together with the population (543 entries).

**The largest measurement (69,743 B) is ≈89% of the 78 KB reference point at which
Phase 4 already once knocked the tool out of commission once**
(`docs/промпт-фаза5.md:120`). Formally under the limit, but close — worth attention
if a detailed listing is ever needed for a family with an even larger population on
an even larger book.

### Whether the ceilings fired

| Ceiling | Fired? |
|---|---|
| `scale.groupsTruncated` | no (5 scale groups, did not hit the ceiling) |
| `styles[].groups[].valuesTruncated` | no (0 rows with truncated values) |
| `hierarchy.chainDepthTruncated` | no (`maxChainDepth` 4, the `basedOn` step ceiling not reached) |
| `detailTruncated` | **yes** — `{ shown: 50, total: 543 }` for `family: "character"`, `styleId: "32513"` |

### Question 3: the true number of character deviations

`detectCharacter` (not the H5 probe, the finished detector, the same one that feeds
`characterBlock.rangesDeviating`):

| What | Value |
|---|---|
| `rangesTotal` (all measured ranges, including masters) | 3507 |
| `rangesAudited` (masters excluded) | 3480 |
| **`rangesDeviating` — THE REAL NUMBER** | **744** |
| `byProperty.pointSize` | 505 |
| `byProperty.fontStyle` | 370 |
| `byProperty.appliedFont` | 343 |
| `byProperty.horizontalScale` | 164 |
| `byProperty.tracking` | 42 |

744 is in the same order of magnitude as the "hundreds" from earlier comment
revisions (`src/tools/styles.ts`, `src/styles/character.ts`, `README.md`), and close
to the final review's estimate of "750–790," but it **does not match** any probe
number: the H5 probe's 449 was measured on a NARROWER population (3137 bare ranges,
`characterStyle === "[None]"`), while `detectCharacter` walks all 3480 audited ranges
regardless of character style. 744 and 449 cannot be compared directly — these are
two different detectors on two different populations; the code comments and the
README now name 744 as this tool's own measurement, and 449 as a separate probe
measurement on a different population (fixed, see below).

### Baseline numbers, measured together

| What | Value |
|---|---|
| paragraph styles declared | 51 |
| paragraph styles used (`paragraphs > 0`) | 37 |
| paragraphs total | 3007 |
| paragraphs off pages | 0 |
| ranges (`ranges`) total | 3507 |
| character styles declared (excluding `[None]`) | 7 |
| character styles used | 5 |
| unused character styles | 2 |
| scales (`scales`) | 163 |
| unused paragraph styles (`style-unused`, family usage) | 14 |
| paragraphs on a default style (`default-style-applied`, excluding masters) | 71 (`[Basic Paragraph]` 25 + `[No Paragraph Style]` 46) |
| overrideFindings (paragraph+property pairs) | 436 |
| scale groups | 5 (ceiling not reached) |
| proportional detector: `matches` | 11 |
| proportional detector: `noRatio` (blind spot) | 423 |
| styles deeper than 1 `basedOn` level (`stylesInChains`) | 36 |
| `maxChainDepth` | 4 |
| hierarchy findings (`styles-indistinguishable`/`based-on-missing`) | 2 |

### Soft reconciliation against the previous scan (260804-2119, `docs/виміряні-факти-масштабовані-рамки.md`)

A different save of the same book; the user worked between the two saves — drift at
this scale is EXPECTED and is not a defect.

| What | Was on 260804-2119 | Measured now (260805-2200) | Delta |
|---|---|---|---|
| styles declared | 51 | 51 | 0 |
| styles used | 37 | 37 | 0 |
| paragraphs | 2980 | 3007 | +27 |
| off pages | 4 | 0 | −4 |
| unused | 14 | 14 | 0 |
| default styles in layout, `[Basic Paragraph]` | 19 | 25 | +6 |
| `horizontalScale` group 96 | 19 (stories = paragraphs, checked separately) | 19 | 0 |
| `horizontalScale` group 109.632164859675 | 131 paragraphs | 131 | 0 |
| proportional detector blind spot (`noRatio`) | 163 (5.5%) | 423 | +260 |
| `Заголовок до чеклисту`, ratio | 1 (21 of 21) | 1 (21 of 21) | 0 |
| `Пункт чеклисту`, ratio | 0 (0 of 134) | 0 (0 of 134) | 0 |

Two rows with a large drift deserve a separate word, WITHOUT turning them into a
"finding" — neither belongs to the four active structural criteria below:

- **default styles in layout +6, but actually also +46 new ones.** The previous
  reference point "19" apparently named only `[Basic Paragraph]` (25 now, a drift of
  +6, plausible for a few days of work). `[No Paragraph Style]` (46) is a separate
  default style, 71 together; the previous table clearly did not name it, so a direct
  "19 → 71" comparison would be a false comparison of different quantities, not a
  finding.
- **`noRatio` 163 → 423.** The briefing's fifth criterion ("`matches + noRatio` sums
  to the number of paragraphs") is clearly FALSE and struck through in the plan:
  `detectRatioScale` has two silent `continue`s, so `matches (11) + noRatio (423) =
  434` — far below the 2987 audited paragraphs, and it was the same way on the
  previous scan. The percentages "5.5%" and "14.2%" are computed from the same
  defective denominator as the criterion itself — comparing the percentages is just
  as unreliable as the discarded criterion itself. Raw numbers are given without a
  conclusion about the cause.

### Structural discrepancies — four active criteria out of five

The briefing's fifth criterion ("`matches + noRatio` sums to the number of
paragraphs") was NOT used — it is false by construction (`detectRatioScale` has
silent `continue`s, point above) and is already struck through in the plan.

| # | Criterion | Result |
|---|---|---|
| 1 | share (`ratio`) above 1 | 0 rows — **none** |
| 2 | `ratio` of an unused style (`paragraphs === 0`) not `null` | 0 rows — **none** |
| 3 | a whole class disappeared (0 scale groups while `scales` is non-empty; 0 unused while 51 declared and 37 used) | 5 scale groups, 14 unused — **none** |
| 4 | `usedStyles` greater than `declaredStyles` | 37 vs. 51 — **none** |

**No structural discrepancies.** All four active criteria pass cleanly.

### The "Основний текст L" name collision — a separate check

The `id` key, for whose sake the report was changed (Tasks 12–15), still shows TWO
separate rows for the same-named style:

| `styleId` | `paragraphs` | `ratio` |
|---|---|---|
| 32513 | 561 | 0.244 |
| 26178 | 0 | `null` |

The collision is still present (the user hasn't removed it — and that's not a
defect, it's a fact about the book), and the unused row correctly shows `paragraphs:
0` rather than disappearing from the report. The 565 → 561 drift on the used row is
expected (the same user work between saves).

### Fixing statements in the code and README against the measurement

Task 10 measured what had until now been only an estimate or a ceiling with margin.
Fixed:

1. **`src/tools/styles.ts`, the comment next to `STYLES_MEASURE_TIMEOUT_MS`** — the
   claim "NO REAL NUMBER EXISTS (Task 10 not done)" replaced with the measured
   10,860 ms.
2. **`src/tools/styles.ts` (the `FAMILIES` docstring and tool description),
   `src/styles/character.ts`, `README.md`** — "hundreds of ranges … no number from
   the tool itself exists, the run hasn't been done" replaced with the measured
   `rangesDeviating = 744`, referencing this section, with an explicit caveat that
   the H5 probe's 449 and the finished detector's 744 are measured on DIFFERENT
   populations (see Question 3 above) and are not interchangeable.

---
