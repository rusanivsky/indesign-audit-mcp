# Measured facts — Phase 4 (H4)

Date: 2026-08-04. InDesign 21.4.1.4 (`Adobe InDesign 2026`). Document:
**«Book-A 260804-0141.indd»** — the same working manuscript as in Phases 2–3,
198 pages, `saved: true`, `modified: false` at launch time (verified with
`indesign_status` before the first run). This is the user's REAL working book, not a
fixture.

The probe ran **not** through File → Scripts, but through `mcp__indesign__indesign_run_jsx`
(handler `src/jsx/run.jsx`, `IDMCP.handlers.run_script`): the script body is passed in
the `script` parameter and executed via `eval` inside `withNoInteraction` +
`withUndo`, with the result read from the `__result` variable. Reason: the script from
the briefing ended with `alert(...)`, and `alert()` in a non-interactive run would have
blocked InDesign forever. So `scripts/probe-layout.jsx` (the artifact, full code) does
not contain `alert()` and does not write a file via `new File(...)` — all output is
collected into an `out` array and placed into `__result` at the end. The line
`#target indesign` is excluded from the body passed into `script`, because `eval()` is
not where a file's script preamble gets compiled; in the artifact file itself
`#target indesign` remains for compatibility with File → Scripts.

The unit of measurement is points, set once
(`app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS`) and restored in
`finally`. This is the only assignment in the whole probe outside `__result`/`out`, and
it is an application setting, not a document one.

**Probes:**

| File / call | What it proves |
|---|---|
| `scripts/probe-layout.jsx` (main run, full code for all 7 questions) | Task 1's briefing, transcribed with two corrections — `__result` instead of `alert()`+`File`, and two additional counters in Question 1 (`exactMatches`, `totalChecked`) for a more precise picture |
| supplementary run (not a separate file — embedded in this document below, section "Question 3") | diagnostics for the `mst.pageItems` vs `masterPageItems` discrepancy, needed because the main run produced numbers that contradict the briefing's comparison logic |

**`doc.modified` before and after:** `false` → `false` in the main run, and separately
`false` → `false` in the supplementary diagnostic run of Question 3. The document
remained unchanged throughout the whole investigation.

**A caveat about the document.** At session start, only `260804-0141.indd` was open,
and that is the name the main run printed. During the work (between the main run and
the diagnostic run of Question 3, or later) another document appeared in InDesign —
`260804-2119.indd`, a newer save of the same manuscript (the same timestamp naming
convention as in Phases 2–3). The Question 3 diagnostic run did not print `doc.name`,
so it cannot be confirmed with full certainty which of the two files was active at that
moment — both had `modified: false` at the time of the final check, so the task's gate
was satisfied regardless of which one it was. Details are in the task report.

---

## Question 1: ε for comparing numbers

**Method.** For every paragraph in every story, `paragraph.firstLineIndent` was
compared against `paragraph.appliedParagraphStyle.firstLineIndent`. Counted
separately: exact matches (`delta === 0`), and nonzero discrepancies below the 0.01 pt
threshold (the noise band from the briefing).

**Raw numbers:**

```
Question 1: paragraphs checked: 2990, exact matches (delta===0): 2981,
nonzero discrepancies below 0.01 pt: 0, maximum among them: 0
```

2990 − 2981 = 9 paragraphs with a real discrepancy ≥ 0.01 pt (genuine
`firstLineIndent` overrides, not noise).

**Conclusion.** Unlike Phase 3 (where space-width gave a spread at the ULP level,
1–2 quanta of InDesign's fixed-point arithmetic), here **there is no noise band
0 < delta < 0.01 pt at all** — 0 samples out of 2990. Paragraphs without an override
give EXACTLY the style value (`delta === 0` bitwise), paragraphs with an override give
a discrepancy that immediately exceeds 0.01 pt. This means: for `firstLineIndent`
**the data give no grounds for a calibrated ε** — there is no noise that could be
measured and used as a starting point, the way Phase 3 did for space width. This is
not a measurement failure — it is different API behavior: a paragraph's numeric style
properties are apparently not computed through the same floating-point line-formatting
path as glyph positions.

**Consequence for Task 6:** ε = 0.01 pt (the threshold value from this same probe,
applied uniformly across all properties in Question 5) is a **safe, conservative
choice** — on this document, no genuine match would fall into the uncertainty zone,
and no genuine override would be missed. But this ε **is not measured from noise** the
way it was in Phase 3 — it is a margin-of-safety choice, justified by the absence of
observed noise, not by its upper bound. If another document shows noise in this band,
it will have to be re-measured on that document specifically.

---

## Question 2: what the API returns for a mixed value

**Method.** Iterate `paragraph.pointSize` across all paragraphs of all stories,
checking `typeof value !== "number"`.

**Raw numbers:**

```
Question 2: no mixed pointSize in the document — the type was not observed
```

**Conclusion.** In this document, no paragraph has a mixed `pointSize` (i.e. no
paragraph contains characters of different sizes within one paragraph). So **the type
and value InDesign actually returns for a mixed numeric property were NOT observed**
by the probe — neither `NothingEnum.NOTHING`, nor a string, nor anything else. Spec §6
warned exactly about this risk: "a mixed value is not a number," and the probe
confirms only half of that statement (that it is NOT a number by API design, judging
by Adobe's documentation), not the concrete type actually observed on real data.

**Degradation (spec §10):** the "mixed values" group in the override detector (Task 6,
spec §7.1 rule 2) MUST check `typeof x !== "number"` as a universal defensive test,
rather than compare against a specific sentinel value like `NothingEnum.NOTHING` via
`===` — because the sentinel's identity is not confirmed on real data. Any non-numeric
value must fall into the "not compared" bucket (a separate category from
"overridden"), rather than crash the detector or be reported as an override. This is
not a probe failure — this is exactly what the planned degradation was supposed to
look like: an honest "not observed," rather than a fabricated number.

---

## Question 3: overridden vs. a DELETED parent element

**Method, run 1 (from the briefing).** For the first 6 pages: the number of
`pageItems` on the applied parent page (`appliedMaster.pageItems.length`), the number
of `masterPageItems` on the document page itself, whether the `overridden` property
is available, and the count where `overridden === true`.

**Raw numbers, run 1:**

```
page 1, items on parent: 2, masterPageItems: 46, overridden available: true, overridden count: 0
page 2, items on parent: 2, masterPageItems: 47, overridden available: true, overridden count: 0
page 3, items on parent: 2, masterPageItems: 46, overridden available: true, overridden count: 0
page 4, items on parent: 2, masterPageItems: 47, overridden available: true, overridden count: 0
page 5, items on parent: 0, masterPageItems: 45, overridden available: true, overridden count: 0
page 6, items on parent: 0, masterPageItems: 46, overridden available: true, overridden count: 0
```

**A finding not in the briefing.** The briefing proposes this conclusion: "if
`masterPageItems.length` < the parent's item count, the difference is the deleted
items." On real numbers this condition **cannot fire at all, in either direction** —
`masterPageItems.length` (45–47) is consistently and substantially GREATER than
`appliedMaster.pageItems.length` (2, or even 0 for pages 5–6), not smaller. In other
words, the two sides of the comparison do not belong to the same population of
objects.

To understand why — a second, diagnostic run (the same document, the same
`modified: false → false`):

```
page 1 (parent G-Template without running heads): mst.pageItems=2, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=46
page 2 (parent G-Template without running heads): mst.pageItems=2, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=47
page 3 (parent G-Template without running heads): mst.pageItems=2, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=46
page 4 (parent G-Template without running heads): mst.pageItems=2, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=47
page 5 (parent A-Template): mst.pageItems=0, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=45
page 6 (parent A-Template): mst.pageItems=0, opposite spread page master.pageItems=696, spread.pageItems (the whole master spread)=866, masterPageItems (on the document page)=46
```

Neither `mst.pageItems` (2 or 0), nor the opposite spread page (696), nor the whole
`spread.pageItems` (866) match `masterPageItems` on the document page (45–47) — and
none of these three alternative figures come close to it in order of magnitude, such
that "deleted items" could be counted from the difference. A likely explanation (not
separately verified, so it is offered as a hypothesis, not a fact): `pageItems` on a
`Page` object apparently counts only top-level items assigned to that specific side of
the spread, while `masterPageItems` on a document page is a flattened projection of
inherited items that includes objects nested in groups and/or items assigned to the
spread as a whole rather than to one side. This hypothesis was not tested by
measurement — that would already be beyond the probe's seven questions.

Moreover, in both run 1 and run 2, among the 6 sampled pages **not a single** element
has `overridden === true` — on this real document, there simply are no parent-element
overrides on the first 6 pages. This means the `overridden` property here is
**confirmed only in the "exists, is boolean, is accessible" part**, but NOT confirmed
in the "correctly returns `true` for an actually overridden element" part — the probe
observed zero positive examples.

**Conclusion (replaces the briefing's conclusion, rather than repeating it):**

1. Comparing counts (`masterPageItems.length` vs. the parent's `pageItems.length`, in
   any of the three tried forms — page, opposite spread page, whole spread) is
   **unsuitable** for detecting deleted elements on this real document. The method
   from the briefing would give a systematically false "nothing was deleted" answer
   regardless of whether something was actually deleted, because the condition
   `masterPageItems.length < parent's pageItems.length` structurally never holds
   (the populations don't match by construction).
2. `pageItem.overridden` as a property is **available and typed** (boolean), but its
   correctness on a positive case (a genuine override) was **not verified by this
   probe** — no such case occurred among the sampled pages.
3. The "deleted parent element" defect **does not work** the way the briefing
   describes on this path — a different matching mechanism is needed (by element
   identity, not by count), and it still needs to be found and verified on the Task 2
   fixture, where elements will be deliberately deleted and deliberately overridden.

**Consequence for Task 7 (the parent-page detector):** do not carry the count-based
comparison from the briefing into the implementation. The "deleted parent element"
defect is a **planned degradation** (spec §10, line 1: "if probe `H4` comes back with
`no` on some property, that group degrades and says so explicitly") until Task 2
provides a fixture with an actually deleted element, against which an alternative
matching method can be verified. `overridden === true` can be used to positively
detect "overridden" whenever it occurs, but this too is worth re-verifying on a
fixture, since the probe has not yet seen a single `true`.

---

## Question 4: `page.side` on an odd page count and on the pasteboard

**Method.** `doc.documentPreferences.facingPages`, and for each of the 198 pages:
`side`, the parent spread's index (`parent.index`), the applied parent page.

**Raw numbers (excerpt — the full list is in the task report's run output above):**

```
Question 4: facingPages=true, pages=198 (odd: false)
page 1, side=RIGHT_HAND, spread=0, parent=G-Template without running heads
page 2, side=LEFT_HAND, spread=1, parent=G-Template without running heads
page 3, side=RIGHT_HAND, spread=1, parent=G-Template without running heads
page 4, side=LEFT_HAND, spread=2, parent=G-Template without running heads
...
page 197, side=RIGHT_HAND, spread=98, parent=G-Template without running heads
page 198, side=LEFT_HAND, spread=99, parent=G-Template without running heads
```

The pattern is strictly regular across all 198 pages: an odd page number (1-based
name) → `RIGHT_HAND`, even → `LEFT_HAND`, with no exceptions; spread 0 contains only
page 1 (a single first spread — standard `facingPages` behavior), and spreads of 2
pages each follow after that.

**Conclusion.** On an **even** page count (198) with `facingPages=true`, `page.side`
behaves predictably: strict alternation of `RIGHT_HAND`/`LEFT_HAND` that matches the
page number's odd/even parity. This is a complete and reliable measurement for this
case.

**What was NOT measured, and why.** The document has 198 pages — an even count.
`page.side` behavior on an **odd** page count (where the last spread might, by
analogy with the «Book-A» defect, shift the alternation) **cannot be observed**
on this document — it requires a document with an odd page count, which does not
currently exist. Likewise, `doc.pages` in principle does not contain pasteboard
objects (the pasteboard is not a `Page`), so `page.side` on the pasteboard is
**methodologically not observable** by this probe, regardless of page count. Neither
point is a measurement failure — they are the limit of what can be measured on the
existing document; both **remain for the Task 2 fixture**, which per spec §9 must
deliberately contain an odd page count.

**Consequence for Task 7:** the mechanism behind the «Book-A» breakage (odd page
count + `page.side`) cannot be considered verified before the Task 2 fixture. A
detector that relies on `page.side` to determine the spread/side of a page must treat
this path as unconfirmed for the odd case — test coverage for it will arrive together
with the fixture, not before.

---

## Question 5: actual volume of overrides

**Method.** For each paragraph in each story: if at least one of 8 properties
(`firstLineIndent`, `leftIndent`, `rightIndent`, `spaceBefore`, `spaceAfter`,
`pointSize`, `leading`, `tracking`) deviates from the style value by more than
0.01 pt (this probe's exploratory threshold, not a product constant — see the caveat
below), the paragraph is counted as overridden. Summarized by the name of the applied
paragraph style.

**Raw numbers:**

```
Question 5: paragraphs total 2990 (override threshold in this probe: 0.01 pt, exploratory)
«Нумерація сторінок» — paragraphs 6, overridden: 0
«Назва розділу» — paragraphs 6, overridden: 0
«Основний текст L» — paragraphs 566, overridden: 134
«Основний текст F» — paragraphs 426, overridden: 10
«Відбивка в тексті» — paragraphs 12, overridden: 0
«H1 Підзаголовок» — paragraphs 40, overridden: 0
«[No Paragraph Style]» — paragraphs 48, overridden: 33
«Підпункти в основному тексті -1» — paragraphs 487, overridden: 7
«Номер розділу» — paragraphs 3, overridden: 0
«[Basic Paragraph]» — paragraphs 25, overridden: 25
«Колонтитул v1» — paragraphs 105, overridden: 0
«Зміст Розділ» — paragraphs 4, overridden: 0
«Зміст Підрозділ» — paragraphs 36, overridden: 0
«Зміст Пункти» — paragraphs 32, overridden: 0
«Зміст Цифра» — paragraphs 3, overridden: 0
«Заголовок до чеклисту» — paragraphs 21, overridden: 21
«Пункт чеклисту» — paragraphs 130, overridden: 0
«Підпункт чеклисту» — paragraphs 284, overridden: 245
«Підназва» — paragraphs 2, overridden: 1
«Checklist R» — paragraphs 7, overridden: 0
«Колонтитул v2» — paragraphs 1, overridden: 0
«Примітки чеклисту» — paragraphs 1, overridden: 0
«Питання в інтерв'ю» — paragraphs 329, overridden: 3
«Заголовок 1 до інтерв'ю» — paragraphs 14, overridden: 0
«Нумерація питань» — paragraphs 185, overridden: 0
«Checklist L» — paragraphs 15, overridden: 0
«Підпункт чеклисту Р2» — paragraphs 6, overridden: 0
«Заголовок 2 до інтерв'ю» — paragraphs 21, overridden: 0
«Підпункти в основному тексті - цифри» — paragraphs 11, overridden: 0
«Відбивка в тексті в інтерв'ю» — paragraphs 19, overridden: 2
«УДК» — paragraphs 9, overridden: 0
«Анотаця» — paragraphs 1, overridden: 0
«Текст по центру» — paragraphs 15, overridden: 15
«Логотип» — paragraphs 1, overridden: 0
«Повідомлення від мам 1» — paragraphs 77, overridden: 0
«Повідомлення від мам 2» — paragraphs 38, overridden: 0
«Питання» — paragraphs 1, overridden: 0
«Основний текст» — paragraphs 3, overridden: 3
```

Sum of overridden paragraphs across all 37 styles: **499 out of 2990** (an exact
count from the numbers above, not an estimate).

**Conclusion.** 499/2990 ≈ 16.7% of paragraphs have at least one overridden property
out of the 8 — a volume for which a plain (single-style) report is entirely readable:
37 summary rows, not thousands of individual findings. The largest concentration is
in «Підпункт чеклисту» (245 out of 284, 86%) and «[Basic Paragraph]»/«Текст по
центру»/«Основний текст» (100% overridden in all three, but these are small styles —
25, 15, 3 paragraphs respectively, so a 100% share here is not a volume alarm). The
numbers do NOT indicate a need for a second summary level (spec §4.4): even the
largest group («Підпункт чеклисту», 245 paragraphs) is one row of a summary report,
not 245 individual findings.

**Caveat:** the 0.01 pt threshold in this question is an exploratory choice made by
THIS probe to estimate order of magnitude. It is **not carried over** into any other
file as a product constant; Task 6 calibrates its own ε (see Question 1)
independently, and depending on the property group (spec §7.2) the threshold may
differ from 0.01 pt.

---

## Question 6: cost of a pass over paragraphs

**Method.** One pass over `firstLineIndent` of all paragraphs of all stories in the
document, timed via `new Date().getTime()` before and after.

**Raw numbers:**

```
Question 6: pass over 2990 paragraphs — 909 ms, i.e. 0.304 ms per paragraph
```

**Conclusion.** 2990 paragraphs / 909 ms is far below the 120-second limit of
`indesign_run_jsx`, and even a character-by-character pass of that same order (Phase
3 measured 0.164–0.44 ms/character) would not come close to it for a document this
size: a typical story in this book has hundreds to thousands of characters, not tens
of thousands per paragraph. A pass over paragraphs across the entire 198-page document
fits within a single `indesign_run_jsx` call without needing to split it into parts —
which this very run confirmed, answering all 7 questions in a single call with no
timeout.

**Consequence for Tasks 6/8/9:** a character-by-character traversal is NOT needed for
summarizing by style (Question 5 already counts through `paragraph`-level properties,
without descending into characters); a pass over paragraphs is a cheap operation, and
`document_map`/`layout_audit` can traverse the whole document in a single JSX call
without segmentation, until something significantly more expensive is added (for
example, a character-by-character pass for character styles — Question 7 below is
deliberately limited to three examples and does NOT extrapolate the cost of a full
character-by-character pass).

---

## Question 7: character style vs. local override

**Method.** Iterate `textStyleRanges` of paragraphs (across stories), stopping after
the first 3 found ranges with an applied character style other than `[None]`.

**Raw numbers:**

```
style «Text Regular Black», ranges in paragraph: 1, paragraph pointSize: 11.5, paragraph style pointSize: 11.5
style «Text Regular Black», ranges in paragraph: 3, paragraph pointSize: 11.5, paragraph style pointSize: 11.5
style «Text Semi Bold Red», ranges in paragraph: 1, paragraph pointSize: 11.5, paragraph style pointSize: 11.5
```

**Conclusion.** In all three examples found, `paragraph.pointSize` remains a number
(not mixed) and is exactly equal to the paragraph style's `pointSize` (11.5 = 11.5),
despite the presence of an applied character style on part of the paragraph. This
confirms part of rule 1 (spec §7.1): the presence of a character style by itself does
**not make** `paragraph.pointSize` mixed and does not distort the paragraph-level
comparison, when the character style does not change the very property being
compared.

**What was NOT confirmed.** All three examples found are character styles that,
judging by their names («Text Regular Black», «Text Semi Bold Red»), change weight
and color, and NOT the point size. The probe stopped at the third found range
(condition `withCs < 3`) and did not check the case where a character style itself
changes `pointSize` — whether this would produce a mixed value at the paragraph
level. Since Question 2 already established that no mixed `pointSize` was observed in
the document at all, this check structurally could not have given a different result
on this document: if there are no mixed values anywhere, then there are none in
paragraphs with character styles that change point size either — because such
paragraphs (where the character style actually differs from the paragraph style in
point size) apparently simply do not exist in this document, or did not make it into
the first 3 found.

**Consequence for Task 6:** rule 1 (a character style is not an override, §7.1) is
confirmed for the case "the character style does not change the property being
compared." The case "the character style changes exactly the property the detector
compares" (e.g. a character style with a different point size) was not separately
verified — it is recommended that the Task 2 fixture explicitly contain such a range,
so that Task 6 can test both cases rather than relying on extrapolation from this
probe.

---

## Final-review measurement (NOT the `H4` probe)

This section stands apart deliberately: it is **not part of the `H4` probe** and does
not belong to the seven questions above. The measurement was taken later, during the
final review of the whole Phase 4 branch (2026-08-05), on the same user working book —
already the next save, **«Book-A 260804-2119.indd»** (198 pages, 2998
paragraphs vs. 2990 in the `H4` probe; the book was edited between runs). Both runs
were read-only, `doc.modified` `false` → `false` before and after.

### Full replica of `detectOverrides` across ALL 12 properties

**Method.** The reviewer ran a full replica of `detectOverrides` — not the 8
properties of exploratory Question 5, but all 12 from `GROUP_PROPERTIES`, with ε = 0
(as in the product), on all 2998 paragraphs.

**Raw numbers:**

```
418 findings, 388 distinct (paragraph, group) pairs. No flooding.
```

**Why this matters.** This removes the main concern about `EPSILON_PT = 0`. Until now
the measurement existed only for `firstLineIndent` (Question 1), and the debt was
honestly recorded as "carried over without measurement": if there is noise on the
remaining numeric properties, ε = 0 would flood the report with findings. It is now
clear that it does not — 418 findings on 2998 paragraphs is the same order of
magnitude as the 499 overridden paragraphs of Question 5 at a 0.01 pt threshold, not
an order of magnitude more. So ε = 0 and ε = 0.01 pt give practically the same volume
on this document, and choosing between them is not a choice between "readable" and
"flooded."

**What remains unmeasured.** Behavior on ANOTHER document. The argument "an error here
fails loudly rather than silently" is a property of choosing ε = 0, not proof of it,
and remains valid as a justification, not as a measurement. If another document shows
noise, ε = 0 will need to be re-measured there specifically.

### `leading: AUTO` — 128 and 35

**Method.** This branch's production serializer `IDMCP.numberOrEnumName`, together
with `IDMCP.declaredStyleValues` / `IDMCP.actualStyleValues`, called on all paragraphs
of the book via `run_script` (i.e. the exact code that will ship in the product, not a
copy rewritten in the probe — a separate run with an inline replica gave the same
numbers).

**Raw numbers:**

```
typeof Leading.AUTO: object, String(): AUTO
paragraph styles total: 51, with leading === AUTO: 10
paragraphs: 2998 (non-master: 2978)
AUTO in both style and paragraph: 128 (non-master: 108)
style AUTO, paragraph numeric: 35 (non-master: 35)
OLD leading behavior: both null: 128; only actual null: 12
OLD sizes/notCompared column, paragraphs: 415 (with masters: 435)
  of which AUTO===AUTO: 108, AUTO vs. a number: 35
masters total: 13 (2-page ones: 13)
```

**Conclusion.** `Leading.AUTO` is a perfectly readable enum, and `String(...)` gives
`"AUTO"`. Passed through the general `IDMCP.propValue` (number-or-string, otherwise
`null`), it became "not compared," and the `sizes / notCompared` column was lying in
**two** different directions at once:

| State | Paragraphs | What the report said | The truth |
|---|---|---|---|
| AUTO in both style and paragraph | 128 | `sizes / mixed` | clean: leading is the same and automatic |
| style AUTO, paragraph numeric | 35 | `sizes / unavailable` | a GENUINE override, invisible in principle |

The share of the column occupied by this lie depends on whether masters are counted —
so both numbers are named separately rather than eyeballed as one:

- **including masters** (`includeMasters: true`): 128 + 35 = **163 of 435** — 37.5%;
- **by default** (masters excluded, `includeMasters: false`):
  108 + 35 = **143 of 415** — 34.5%.

After the fix, 128 (respectively 108) become clean (AUTO === AUTO), and 35 become
findings (AUTO ≠ 14). So a third of the "not compared" column on this book was either
lying, or hiding a finding.

The row "only actual null: 12" is a control: 12 paragraphs have a numeric baseline
while genuinely having mixed leading inside the paragraph. The `mixed` label, after the
fix, does not end up without a referent — it simply stops collecting other cases that
don't belong to it.

**A side measurement that disproved the recorded justification.** The book has **13
masters, and all 13 are two-page**. So a single-page master IS a real layout case in
general (a section-opener page), but **not for this book**; the earlier claim in
`docs/ПРОДОВЖИТИ-ТУТ.md` about "a real case for this book" has been corrected. The bug
itself and its fix (Task 7) are real — what measurement showed to be false was only
the justification, and it is precisely the absence of this state in the real data that
explains why the defect went unnoticed.

---

## Summary: what got an answer, what did not

| Question | Answered | Caveat |
|---|---|---|
| 1. ε for comparing numbers | Yes, partially — zero observed noise instead of a calibrated ε | ε remains a conservative choice (0.01 pt), not derived from noise |
| 2. Type of a mixed value | No — there are no mixed values in the document | Planned degradation: a defensive `typeof !== "number"` check, not a comparison against a sentinel |
| 3. overridden vs. deleted | Partially — the `overridden` property exists and is typed, the count-based method from the briefing is disproven on real numbers | The positive case `overridden === true` and a deletion-detection mechanism are not verified, they need the Task 2 fixture |
| 4. page.side | Yes, for an even count and `facingPages=true` | An odd count and the pasteboard are methodologically not observable on this document, awaiting the fixture |
| 5. Volume of overrides | Yes, fully — 499/2990 across 37 styles | The 0.01 pt threshold is exploratory, not carried over as a constant |
| 6. Cost of the pass | Yes, fully — 0.304 ms/paragraph, 2990 paragraphs in 909 ms | — |
| 7. Character style vs. override | Partially — confirmed for styles that don't change the compared property | The case of a character style changing point size was not observed, a recommendation for the fixture |

**Task 1's gate is not blocked**: no question was left completely unanswered (the
worst case is "partially," with an explicitly named unmeasured remainder and an
explicit consequence for the relevant task). Tasks 6 and 7 can rely on these numbers,
subject to the caveats above.

**The table describes the state as of 2026-08-04.** The later "Final-review
measurement" section (above) partially closes row 1: ε = 0 has now been measured not
on one property, but on all 12, and flooding was not confirmed. Row 2 ("type of a
mixed value") remains open in the same form — the 12 paragraphs with mixed `leading`,
found by the final review, produce `null` through the `textStyleRanges` traversal,
not through an observed API sentinel.
