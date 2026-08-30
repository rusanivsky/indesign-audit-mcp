# Measured facts — Phase 10 (running head)

**When:** 2026-08-14
**Where:** InDesign **21.5.1.73**, the working book `Book 260811-1645.indd`,
196 pages, `modified: false` before and after
**With:** probes `H10-A`…`H10-E`, all **read-only** — no assignment to any
document property, no `save`/`close`

Each probe set `app.scriptPreferences.measurementUnit = POINTS` on entry and
restored the previous value in a `finally` — a safeguard that
`pagination-apply.test.ts` was missing, and that just cost the project a red
test, C2.

---

## Question 1: where running heads live

**On master pages, and only there.** `H10-B` walked all 196 pages using two
keys — `page.masterPageItems` and `page.textFrames`:

| | |
|---|---|
| pages that get their running head from a master | **50** |
| pages with a **redefined** running head | **0** |
| the side all 50 sit on | **verso** (LEFT_HAND) |

So `page.textFrames` here gives **zero out of fifty**. This is the same
tool blindness that made Phase 6 record "there is no running head in this
book" on 2026-08-07, and that is exactly why the source has to be the
**union** of the two keys, not either one alone.

---

## Question 2: literal text or a text variable

**Literal.** `textVariableInstances` in each of the eight master frames is
**empty**. This matters because Phase 6 named a text variable,
`MATCH_PARAGRAPH_STYLE_TYPE` ("the running head carries the heading by
itself"), as the ready-made solution: in this book it is not used, so there
is no self-update, and a mismatch is physically possible.

For comparison: 35 table-of-contents numbers in this same book **are** made
of variable instances (measured in Phase 6). So the book knows this
mechanism and deliberately did not use it in running heads.

---

## Question 3: what distinguishes a running head from a folio number

**NOT the style name.** Measured on masters `E`, `D`, `J`: the style
`Колонтитул v1` carries **both** frames there.

| Master | Side | Style | Layer | Content |
|---|---|---|---|---|
| `E-Розділ 1` | verso | `Колонтитул v1` | `Шар 1` | «Вагітність — це новий світ» |
| `E-Розділ 1` | recto | `Колонтитул v1` | `Нумерація` | `⟨PREVIOUS⟩–⟨AUTO⟩` |

On masters `B`, `C`, `I` the same folio number is set in a **different**
style — `Нумерація сторінок`. So the book sets the folio number in two
different styles depending on the master; for Phase 10 that is not a
defect (it is not this phase's family), but it is recorded.

**What distinguishes them is the absence of page-numbering special
characters** — `AUTO_PAGE_NUMBER`, `PREVIOUS_PAGE_NUMBER`,
`NEXT_PAGE_NUMBER`, `SECTION_MARKER`, compared by identity.

**This is why the contradiction between documents stood for three phases.**
Phase 6 looked at recto and said "`Колонтитул v1` is the folio number." The
backlog looked at verso and said "running heads are set in `Колонтитул
v1`." **Both are right**; the false assumption was that the style name
determines the role.

---

## Question 4: inventory of masters

Eight masters carry a running head, all on verso, all 10 pt:

| Master | Style | Text | Weight | Ink |
|---|---|---|---|---|
| `C-Передмова` | v1 | Передмова | **Light** | `C=20 M=100 Y=70 K=10` |
| `I-Зміст` | v1 | ЗМІСТ | Regular | `C=20 M=100 Y=70 K=10` |
| `E-Розділ 1` | v1 | Вагітність — це новий світ | Regular | `C=20 M=100 Y=70 K=10` |
| `D-Розділ 2` | v1 | ПОЛОГИ — ЗУСТРІЧ З МАЛЮКОМ | Regular | `C=20 M=100 Y=70 K=10` |
| `J-Розділ 3` | v1 | ПЕРШІ МІСЯЦІ З МАЛЮКОМ — ЖИТТЯ НА ДВОХ | Regular | `C=20 M=100 Y=70 K=10` |
| `H-Чеклисти Р1` | v2 | Вагітність — це новий світ | Regular | *(name empty)* |
| `M-Чеклисти Р2` | v2 | ПОЛОГИ — ЗУСТРІЧ З МАЛЮКОМ | Regular | *(name empty)* |
| `N-Чеклисти Р3` | v2 | ПЕРШІ МІСЯЦІ З МАЛЮКОМ — ЖИТТЯ НА ДВОХ | Regular | *(name empty)* |

Without a running head: `F-Шаблон інтерв'ю` (**78** pages), `G-Шаблон без
колонтитулів` (17), `A-Шаблон` (3), `B-Шаблон лише сторінки`.

**A finding worth reporting right now:** "Передмова" is set in `Proba Pro
Light`, while its own style declares `Regular`, and all seven other running
heads are `Regular`. A local override on the master, visible on the page.

**A trap named before it could be written:** the `Колонтитул v2` ink has an
**empty name**. Comparing running heads "by ink name" would treat two
different unnamed colors as identical — i.e. it would be a check that can
never fail.

---

## Question 5: capitalization — NOT a defect

Chapter 1's running head is set in lowercase («Вагітність — це новий
світ»), chapters 2–3 in uppercase. It looks like an obvious inconsistency,
and that is exactly why it was measured before writing a rule:

| | |
|---|---|
| `Колонтитул v1.capitalization` | **ALL_CAPS** |
| `Колонтитул v2.capitalization` | **ALL_CAPS** |
| actual `capitalization` in all 8 frames | **ALL_CAPS** |

Both styles normalize the case, so **there is no difference on the page**.
No rule about capitalization gets written. Without this measurement the
phase would have produced eight false positives and called them a finding.

---

## Question 6: chapter boundaries

The style `Назва розділу` ("chapter title") — 10 paragraphs, `Номер
розділу` ("chapter number") — 3:

| Page | Paragraphs (as typeset) | Number |
|---|---|---|
| 6 | «зміст» | — |
| 13 | «передмова» | — |
| 21 | «Вагітність —» + «це новий світ» | 1 |
| 97 | «Пологи —» + «зустріч» + «з малюком» | 2 |
| 129 | «Перші місяці» + «з малюком —» + «життя на двох» | 3 |

**Spans:** 6–12, 13–20, 21–96, 97–128, 129–196. Pages 1–5 belong to none of
these — a third state, not "chapter 0."

The styles `H1 Назва розділу` and `H0 Номер розділу` exist but have **0**
occurrences — dead twins, just like the two different "Основний текст L"
styles in this book.

---

## Question 7: does the running head match the chapter heading

**A direct search gave 0 — and that is a tool trap, not a fact.**

| Search over the book's text | Found |
|---|---|
| «Вагітність — це новий світ» | **0** |
| «ПОЛОГИ — ЗУСТРІЧ З МАЛЮКОМ» | **0** |
| «ПЕРШІ МІСЯЦІ З МАЛЮКОМ — ЖИТТЯ НА ДВОХ» | **0** |

The reason is that the heading is split across paragraph lines. Joining
adjacent paragraphs of one heading and normalizing case gives an **exact**
match on all three:

```
с. 21:  «Вагітність —» + «це новий світ»              = running head, master E ✓
с. 97:  «Пологи —» + «зустріч» + «з малюком»          = running head, master D ✓
с. 129: «Перші місяці» + «з малюком —» + «життя на двох» = running head, master J ✓
```

Had the phase trusted the first measurement, it would have concluded "a
reference derived from the heading is impossible" and built a weaker
family — based only on mutual consistency. **A zero without checking the
tool itself means nothing** — the same lesson the `ICONV` mutant taught in
Phase 9.

---

## Question 8: are there mismatches in the book itself

Cross-checking the spans against the masters actually applied:

| Chapter | Span | Running-head masters | Mismatches |
|---|---|---|---|
| 1 | 21–96 | `E` (pp. 22–94), `H` (34, 42, 50, 68) | **0** |
| 2 | 97–128 | `D` (98–126), `M` (102) | **0** |
| 3 | 129–196 | `J` (130–192), `N` (154–172) | **0** |

Opener pages 21, 97, 129 sit on master `G`, meaning the running head is
removed on them **deliberately** — and none of them lands in
`head-unexpected`.

**Consequence for acceptance:** four of the five rules will give zero on
this book. A run on the book cannot be proof; the proof is the fixture and
the mutants, and the book remains a control run with a pre-declared
expectation, `0 / 0 / 0 / 0 / 1`.

---

## Document state after all probes

```
Book 260811-1645.indd | pages=196 | modified=false | saved=true
```

No change at all. `modified` stayed `false` after five probes in a row.

---

## Proof of the phase — mutants and a control run (2026-08-14)

### Five mutants, killed by EXECUTION

| Mutant | Result | Which test failed |
|---|---|---|
| `normalizeTitle` does not normalize case | **killed** | three, including "the running head names ITS OWN chapter" |
| `chapterSpans` does not join paragraphs | **killed** | "JOINS adjacent paragraphs of one heading" |
| `head-missing` ignores `expectedByMaster` | **killed** | "a master WITHOUT a running head — head-missing does NOT fire" |
| `fillValue === null` counts as equal | **killed** | "fillValue null is NOT equal to any" |
| `headReference` picks the first, not the mode | **SURVIVED** | — |

**The fifth passed all 21 tests green, and that is the most valuable thing
the proof produced.** The cause is not the mutant, but the test: it put the
majority as the FIRST element, so "first" and "mode" coincided in it, and
the substitution changed nothing. A mutant nobody kills means "the rule is
untested," not "the rule is correct" — the same lesson `ICONV` taught in
Phase 9. A test was added where the first element does NOT belong to the
mode, and where the mode is checked across all four reference fields;
re-running the same mutant gave `1 failed | 21 passed`.

### Control run: the first attempt DIVERGED from expectation

Expectation recorded before the run: `0 / 0 / 0 / 0 / 1`.
Obtained: `0 / 0 / 0 / 0 / **4**`.

Three extra findings — all running heads in style `Колонтитул v2`
(checklists, masters `H`, `M`, `N`): ink `CMYK:2,8,23,0` against the accent
red `CMYK:20,100,70,10` of style `v1`.

**The expectation was not adjusted to fit — the model was fixed.** The rule
required TWO DIFFERENT NAMED STYLES to look identical, and the styles are
different for a reason: `v2` is lighter because it sits on a colored panel.
The document declares two styles — so there are two reference values as
well (§3.2: the reference is derived from the document). The appearance
reference became **per-style**; the side stayed document-wide, because a
running head's side is a layout property, not a style property.

**The price is stated out loud:** if a layout designer mistakenly applied
`v2` where `v1` belonged, the appearance rule would stay silent — the frame
is compared against its own style and looks flawless. The opposite choice
produces three findings where the layout is actually correct.

### Control run after the fix — a match on all five

```
rule                    | expected | actual | verdict
head-wrong-chapter     |         0 |        0 | match
head-missing           |         0 |        0 | match
head-unexpected        |         0 |        0 | match
head-side-stray        |         0 |        0 | match
head-style-stray       |         1 |        1 | match
```

The one finding:

```
[head-style-stray] p.14 frame 32561: weight Proba Pro Light against
Proba Pro Regular. Pages under this frame: 3.
```

Along the way, the run confirmed the probe numbers on the real code: **50
running-head assertions, 50 from the master, 0 redefined, 0 uncompared**,
and five chapter spans — "table of contents" (offset 5–11), "preface"
(12–19), "Вагітність — це новий світ" (20–95), "Пологи — зустріч з
малюком" (96–127), "Перші місяці з малюком — життя на двох" (128–195).

### Read-only-ness — by a content signature, not a flag

The `modified` flag is monotonic and proves nothing. A signature was
measured before and after the full run:

```
BEFORE: {"stories":574,"chars":219154,"items":965,"checksum":1573030006,"pages":196}
AFTER:  {"stories":574,"chars":219154,"items":965,"checksum":1573030006,"pages":196}
```

Byte-for-byte identical.
