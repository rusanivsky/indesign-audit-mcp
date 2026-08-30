# Measured facts, Phase 6 — probe `H6`

Date: 2026-08-07, night. Run through the built branch (`npm run build`, then
`runJsx` from `dist/`), **not** through `mcp__indesign__*`: the MCP server was
running from the main checkout and would have silently served the old build.

Document: **`Book 260807-0100.indd`, 196 pages**. `doc.modified` was
`false` before the probe and `false` after — all measurements on the book are
read-only.

**Note on the filename and the page count.** The spec was written against
`260806-1100.indd` (198 pages). Overnight the user trimmed the book to 196
pages and rebuilt the table of contents. The numbers here refer to the new
edition; wherever they diverge from the spec, the divergence is called out
explicitly.

Scripts: `scripts/probe-h6-markers.jsx` + `scripts/probe-h6-read.mjs`
(Questions 1–2, on their own temporary fixture), `scripts/probe-h6-book.jsx`
(Questions 3–5, 7, read-only on the book).

---

## Measurement method for Questions 1–2, and why the first method was discarded

The DOM **does not return the marker's resolved value**: `character.contents`
returns exactly the `SpecialCharacters` enumeration.

The first version of the probe read it via
`story.exportFile(ExportFormat.TEXT_TYPE)`. **The negative control rejected
this:** `AUTO_PAGE_NUMBER`, whose answer is known in advance ("4"), came back
as an empty string.

| Method | `AUTO_PAGE_NUMBER` control on p.4 | Fit for purpose |
|---|---|---|
| `TEXT_TYPE` export | `"\n"` | **broken** |
| PDF export + `pdfjs` | `"4"` | works |

Without the control, the four "empty" results of the first run would have
read as "the marker doesn't work." It was actually a **broken instrument**,
not a non-working marker, and the conclusion would have been the opposite of
correct.

**The same run's second trap.** Frames were placed at ABSOLUTE coordinates,
and on a spread the coordinate system is shared between both pages — frames
landed on pages other than the ones intended. Fixed by measuring from
`page.bounds` plus verifying `frame.parentPage.name` inside the probe itself.

---

## Question 1: `PREVIOUS_PAGE_NUMBER` — WORKS, conditional on overlap

Fixture: 6 pages, main-text story threaded through pages 2 → 3 → 4.

| Case | Page | Previous | In PDF | Conclusion |
|---|---|---|---|---|
| `AUTO_PAGE_NUMBER` control | 4 | — | **4** | the measurement method works |
| **A — frame OVERLAPS the threaded frame** | 4 | 3 | **3** | **the marker works** |
| B — frame overlaps nothing | 4 | 3 | **4** | shows the current page |
| C — overlaps a SEPARATE story | 6 | 5 | **6** | shows the current page |

**Memory was half right, and it's exactly the missing half that matters.**
The July note "a frame placed on its own shows the current page" is
confirmed by case B. But the marker's actual condition is overlap with the
threaded frame, and that condition had never been tested: case A gives the
**true previous page**.

**The limit, confirmed by case C:** the marker gives the page of the
PREVIOUS FRAME IN THE THREAD, not "current minus one." Where the story
breaks — section openers, interviews, checklists — it silently shows the
current page. In case A the two values happened to coincide (the previous
frame happened to sit on the previous page).

---

## Question 2: the Running Header variable carries the heading forward

The `VariableTypes.MATCH_PARAGRAPH_STYLE_TYPE` variable, matched by paragraph
style.

| Page | Has a heading of this style | In PDF |
|---|---|---|
| 2 | yes ("ЗАГОЛОВОКРОЗДІЛУ") | `ЗАГОЛОВОКРОЗДІЛУ` |
| 5 | **no** | `ЗАГОЛОВОКРОЗДІЛУ` |

**Answer: it shows the heading from the previous page, not blank.** In other
words, the variable behaves exactly as a running header should, and a manual
running header can be replaced by it entirely.

Aside: `VariableTypes.RUNNING_HEADER_PARAGRAPH_STYLE_TYPE` **does not
exist** — InDesign rejects that enum name. The correct one is
`MATCH_PARAGRAPH_STYLE_TYPE`.

---

## METHODOLOGICAL FINDING: `page.textFrames` is blind to anchored frames

Discovered while trying to locate the column of numbers in the table of
contents.

| Page | `page.textFrames` | `allPageItems` → TextFrame | groups |
|---|---|---|---|---|
| 7 | 3 | **11** | 0 |
| 8 | 1 | **9** | 0 |
| 9 | 3 | **10** | 0 |
| 10 | 2 | **9** | 0 |
| 11 | 2 | **8** | 0 |

No groups — the difference comes from **anchored** frames (`frame.parent` is
of type `Character`). Everything interesting in this book is anchored:
question numbers, checklist rules, and now the table-of-contents numbers too.

**Consequence for the spec: a measurement pass must walk `allPageItems`, not
`page.textFrames`.** Otherwise the `contents` family would see NO numbers at
all and would report "no findings" — the same fail-silent mode Phase 5 caught
five times.

---

## Question 3: the table of contents is already partly automated

The numbers in the table of contents are **no longer literal digits**. Each
one is now a separate **anchored frame holding a text-variable instance**:

| What | Value |
|---|---|
| `doc.crossReferenceSources` | **35** |
| `doc.crossReferenceFormats` | 10 |
| the `XREF_PAGE_NUMBER_TYPE` variable | present (`TV XRefPageNumber`) |
| hyperlinks | 98 |
| number-frames on p.8 | 8, exactly 1 variable instance in each |

As recently as yesterday (`260806-1100.indd`) the same numbers sat as
literals in a single story: `story:28` read as `4851566064698992`. **In other
words, the table of contents is being converted to cross-references right
now.**

Table-of-contents lines by style (pages 7–11, found by the "Зміст" style
prefix rather than by page number — the numbers shifted overnight):

| Style | Paragraphs |
|---|---|
| `Зміст Розділ` | 4 |
| `Зміст Підрозділ` | 22 |
| `Зміст Пункти` | 34 |
| `Зміст Цифра` | 3 (these are CHAPTER numbers — "1", "2", "3", 25 pt) |

Leading of the table-of-contents lines: **7.056 mm** and **4.939 mm**.

**The distribution of |baseline Δ| was not measured** — the question lost
its point in the framing it was originally asked: few "literal number ↔
title" pairs remain, and geometric matching for cross-references isn't
needed at all. This changes the `contents` family, see "What follows from
this."

---

## Question 4: composition of the folio

| What | Value |
|---|---|
| `auto-page-number` markers in the document | **91** |
| frames with at least one marker | **91** |
| frames with digits only and NO marker | **3** |
| `section-marker` | 0 |

Measured via `page.textFrames`, i.e. **without anchored frames** — the number
91 is a lower bound, not a full count. A second pass over `allPageItems` was
not run.

---

## Question 5: ~~there is NO running header with the chapter name~~ — ANSWER WRONG

> **CORRECTED 2026-08-07 by probe `H7`, Question 1. A running header with the
> chapter name DOES exist in the book.** It sits on the **verso of parent
> pages** `E`, `D`, `J` ("Вагітність — це новий світ", "ПОЛОГИ — ЗУСТРІЧ З
> МАЛЮКОМ", "ПЕРШІ МІСЯЦІ З МАЛЮКОМ — ЖИТТЯ НА ДВОХ"), plus `C-Передмова` and
> `I-Зміст`.
>
> **The cause of the error is not a sloppy measurement but a blind spot in
> the traversal. But it is a SECOND blind spot, not the same one as anchored
> frames — the two must not be conflated:**
>
> | What is invisible | To what |
> |---|---|
> | anchored frames | `page.textFrames`. **`allPageItems` SEES them** — see the table above: 3 vs. 11 on one page, and that's exactly why Phase 6 switched the pass to `allPageItems` |
> | master-page items never overridden on the page | **NEITHER `page.textFrames` NOR `page.allPageItems`.** A separate source is needed — `page.masterPageItems` |
>
> Probe `H6` walked `page.textFrames` (`scripts/probe-h6-book.jsx:60,79` —
> it contains zero references to `allPageItems`), looking for frames that
> repeat across pages, and running headers simply did not exist for it: they
> lived on the masters and were never overridden on any page.
>
> The same blind spot hid **40 even-numbered pages** and the master's
> automatic folio `⟨PREVIOUS⟩–⟨AUTO⟩`, which is the source of all 91 manual
> literals in the book.
>
> **Consequence for the `runningHead` family:** its cancellation in Phase 6
> was decided on a false measurement. Material for it DOES exist in the
> book. This does not make Phase 6 wrong — a full running-header audit was
> never in its scope anyway — but "no material" must be read as "the
> measurement didn't see it."
>
> Numbers and method: `docs/measured-facts-phase7.md`, Question 1 and
> Question 6.

Below is the measurement as `H6` actually made it, kept unchanged.

Text frames that repeat on more than 5 pages:

| Style and content | Pages |
|---|---|
| `Checklist L` \|\|\| `CHECKLIST` | 14 |
| `Checklist R` \|\|\| `CHECKLIST` | 7 |

This is the checklist's decorative label, not a running header with the
chapter name. The `Колонтитул v1` style found earlier turned out to be the
folio itself.

~~**Answer: the book has no running header with the chapter name.** The
`runningHead` family has no material — spec §4.6 anticipated exactly this
outcome.~~

**This answer is wrong — see the box at the top of the section.** The
`runningHead` family does have material; the measurement failed to see it.

---

## Question 6: the `document_map` failure does NOT reproduce

| Call | Result |
|---|---|
| `pages: ["7","8","9","10","11"]` | OK, 5 pages |
| `pages: ["60","61"]` | OK, 2 pages |
| `pages: ["60"]` | OK, 1 page |

On 2026-08-06 the last two calls failed twice with
`osascript syntax error: Expected end of line but found "script"`. They pass
now. Per the Phase 4 rule **this is not a regression** until reproduced; the
most likely cause is that InDesign was busy while the user was working in
the document.

---

## Question 7: no orphaned jump markers

`next-page-number` and `previous-page-number` in the document: **0**.

The limit named in spec §7 (orphaned characters outside the folio are not
caught) remains theoretical for this book. **But it has become more
important, not less:** 35 live cross-references are 35 places where deleting
the source would leave an orphaned character.

---

## What follows from this for the phase

1. **The `runningHead` family is not born.** ~~There is no material~~ — **the
   measurement failed to see it** (Question 5, corrected 2026-08-07). The
   decision for Phase 6 stands, but its basis is false.
   Question 2, however, hands over a ready-made solution should a running
   header ever be needed: the `MATCH_PARAGRAPH_STYLE_TYPE` variable carries
   the heading forward on its own.
2. **The measurement pass walks `allPageItems`.** Otherwise it is blind to
   everything anchored, and in this book the most interesting things are
   anchored.
3. **The `contents` family changes purpose.** The table of contents is being
   converted to cross-references; there is soon nothing left to reconcile
   literal numbers against actual pages. The useful question is now
   different: **which table-of-contents lines are NOT yet converted** —
   exactly the way `folio-manual` says "this number is manual."
4. **The `folio` family remains needed and the most valuable.** 91 frames
   with an auto-marker plus a manual number right next to it — exactly the
   class that broke twice.
5. **`PREVIOUS_PAGE_NUMBER` offers a way to eliminate the class, but a
   narrow one.** It only works where the frame overlaps the threaded frame
   and the thread's previous frame sits on the previous page. In a book with
   broken stories that isn't everywhere — meaning this is material for
   Phase 7, not a reason to cancel the audit.


---

## Run of the finished tool (Task 14)

Date: 2026-08-07. Document `Book 260807-0100.indd`, 196 pages,
read-only. Through the built branch (`npm run build` + `runJsx` from
`dist/`), not through `mcp__indesign__*`.

The `contents` family **was not run**: the mapping "table-of-contents line
style → body heading styles" is known only to the user, and guessing it is
forbidden by the phase's own principle (§3). The number style was
identified — **`Зміст Номер сторінки`, 35 anchored frames**, exactly as many
as the cross-references in the document.

### The `folio` family

| What | Value |
|---|---|
| measurement time | **820 ms** (ceiling `PAGINATION_MEASURE_TIMEOUT_MS` — 120,000, 0.7% used) |
| folio frames | **91** |
| `checked` / `notCompared` | 91 / 0 |
| **`deviating` (NUMBER defects)** | **0** |
| `folio-manual` | **91** |
| size without `detail` | **33,437 B** |
| size with `detail` | **51,665 B** |
| `detailTruncated` | `{ shown: 50, total: 91 }` — the ceiling kicked in |

### The run found a bug in the detector itself

**The first run reported 0 findings on 91 frames** — and that was untrue
about the book.

This book's folios look like "6–⟨auto-marker⟩": the left number typed by
hand, the right one automatic. The `folio-manual` condition was "literals
are present AND no auto-marker is present," so on a mixed frame the detector
stayed silent. In other words the tool was silent about all 91 frames —
**exactly the class that broke twice in this book** (a −2 shift on 76 pages
on 2026-07-29; 52 frames on the wrong side on 2026-08-04).

The condition was fixed to "literals are present," with separate wording for
the mixed case. **A mixed frame is even worse than a fully manual one:** half
the number updates itself, half doesn't, so on recomposition they will drift
apart while the folio looks the same as always.

This is the finding the real-document run exists for: all 1165 tests were
green, and the tool did not see the book's main defect.

### What "0 number defects" means

The folios are **currently arithmetically correct** — both historical
defects have been fixed. The `folio-manual` × 91 finding says something
else: they will break again at the first odd change in page count, because
the left half of every one is typed by hand.

### Collapsing identical findings — a measured result

The systemic defect cost **33 KB to say one thing**: 91 nearly identical
`folio-manual` records. On 2026-08-07 the user decided to collapse identical
ones into a single row. Measured after the change:

| Call | Before collapsing | After | Difference |
|---|---|---|---|
| without `detail` | 33,437 B | **733 B** | **×46** |
| with `detail` | 51,665 B | 18,961 B | ×2.7 |

Grouping is **by `defect`, not by value**: each of the 91 findings had its
own `claimed` (2, 4, 6, …), so grouping by the value pair would not have
collapsed any of them.

The group carries `count: 91`, a list of 20 pages, and
`pagesTruncated: {shown: 20, total: 91}`, plus one `example` with the full
explanatory text. Twenty pages are enough to see the pattern: in this book
they are all odd — i.e. the folio sits on the recto, as it should.


---

## Run of the `contents` family (2026-08-07)

The user named the level mapping: "Зміст Розділ → Заголовок розділу, Зміст
Підрозділ → Підзаголовок." Styles with exactly those names **do not exist**
in the document; by actual usage, `Назва розділу` (6 paragraphs) and `H1
Підзаголовок` (42) read unambiguously. Empty same-named duplicates `H1
Назва розділу` and `H0 Номер розділу` were discarded.

### The run found a THIRD tool bug

The first run showed that the "Зміст Розділ" level has **13 lines with a
number**, though the table of contents has only 4.

Cause: a frame's role was determined by the style of its FIRST paragraph,
and then its **entire** content rode along with that same style. In the
actual table of contents one frame holds all three levels, so 80 paragraphs
were counted as the first level.

**The level is a property of the PARAGRAPH, not the frame.** This never
surfaced on the fixture, where every title was its own frame. Fixed —
`ClaimParagraph.styleName`.

### Numbers after the fix

| What | Value |
|---|---|
| title paragraphs by style | `Зміст Розділ` 4, `Зміст Підрозділ` 40, `Зміст Пункти` 34, `Основний текст L` 2 |
| numbers (anchored `Зміст Номер сторінки` frames) | 35 |
| pairs built | 21 |
| **pairs by level** | **`Зміст Пункти` 20, `Зміст Розділ` 1, `Зміст Підрозділ` 0** |
| `contents-ambiguous` | 14 |
| `contents-count-mismatch` | 2 (both declared levels) |
| response size | 1,074 B |

### Two things that need the user

**1. The numbers don't sit where the mapping says.** Geometry matched 20 of
21 pairs to `Зміст Пункти` lines, and **none** to `Зміст Підрозділ`. In
other words, in this book's table of contents the page numbers belong to
the ITEMS level, not the subsections level. Because of this the declared
mapping produces a `count-mismatch` on both levels: one pair against 6
headings in `Зміст Розділ`, zero pairs against 42 in `Зміст Підрозділ`.

**2. Fourteen ambiguous pairs.** Within half a leading's tolerance of a
number sit TWO table-of-contents lines. This means the numbers sit roughly
MIDWAY between lines, not on the same baseline as either one. The tool has
no right to guess — and that is exactly what the finding records.

### Both causes found — and neither was what it looked like

Rendering the table of contents line by line (p.8, baselines) answered both
questions at once.

**1. The numbers belong to the `Зміст Пункти` level.** Every number sits on
exactly the same baseline as a `Зміст Пункти` line; `Зміст Підрозділ` lines
("4. БАДи: підтримка зсередини") have no numbers at all. The mapping the
user named referred to other levels, which is why it produced zero pairs.

**2. The ambiguity had TWO technical causes, both fixed.**

- **empty spacer paragraphs** in the table of contents share the same style
  and have their own baseline, so they fell within tolerance. An empty line
  cannot be a table-of-contents line — excluded from the candidates (14 →
  11);
- **the baseline is shared across a SPREAD, not a page.** A line on p.8 and
  a line on p.9 at the same height share the same baseline: "БАДи під час
  вагітності" (p.8) and "1. План пологів" (p.9) both at 46.2. Candidates
  narrowed to the same PAGE (11 → 0).

### Summary of the `contents` family

| | Before | After |
|---|---|---|
| pairs out of 35 numbers | 21 | **35** |
| `contents-ambiguous` | 14 | **0** |

The working level mapping for this book:
`Зміст Пункти → H1 Підзаголовок`, `Зміст Розділ → Назва розділу`.

**`contents-count-mismatch` remains:** the table of contents has 34 "Items"-
level lines with a number, while the body has 42 `H1 Підзаголовок` headings.
Matching by order was halted — correctly so, until it's understood why the
counts differ.

### A structural conclusion more important than the geometry

`Зміст Пункти` lines start with `￼` — **the number is anchored INSIDE the
title paragraph**. In other words the "title ↔ number" link is now
STRUCTURAL, not merely geometric: when the probe was asking about geometry,
the numbers still sat as a separate story, and overnight the user converted
them to anchored cross-references.

After the two fixes, geometric matching gives 35 of 35, so there is no
immediate need to change it. But **the structural path is more precise by
construction** — it needs neither tolerance nor threshold — and it is the
best candidate for improving the `contents` family.
