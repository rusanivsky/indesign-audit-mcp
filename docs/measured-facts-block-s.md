# Measured facts — block `S`, consistency BETWEEN DIFFERENT styles

Probe `HS`, 2026-08-15, book `Book 260811-1645.indd` (196 pages, opened
by the user, `modified = false` before and after). Read-only: the probe
calls the already-existing `styles_measure` handler and nothing else.

Scripts: `scripts/probe-hs.mjs` (pass 1, through InDesign),
`scripts/probe-hs-nearmiss.mjs` (pass 2, offline over the saved numbers),
`scripts/probe-hs-timing.mjs` (extra timing and flag measurement).

**One-line conclusion: the measurement did NOT confirm block `S` in its
intended form.** On this book the whole family reduces to a SINGLE detector
with four findings, and every other detector considered would report the
layout designer's intent as a defect.

---

## 0. The phase needs no new JSX

`IDMCP.declaredStyleValues` (`src/jsx/map.jsx:83`) already returns all 12
properties per style, dating back to Phase 5, and `styles_measure` already
returns `styles[]` with `declared`, `basedOnId`, and `path`. So block `S` is
**pure TypeScript on top of an existing measurement**, like Phases 11 and
12. This was struck off the list of unknowns, not guessed at.

**A limitation stated up front:** there is no measurement for CHARACTER
styles — `out.characterStyles` only carries `id`/`name`/`appliedRuns`, no
`declared`. Consistency between character styles would need new JSX, and
this measurement says nothing about it.

## 1. Population (Q1)

| What | How many |
|---|---|
| paragraph styles declared | 56 |
| of which used outside masters | **40** |
| character styles / used | 9 / 7 |
| paragraphs / off-page | 2868 / 5 |
| typefaces among used styles | 3 — Proba Pro 33, ZT Neue Ralewe 6, Minion Pro 1 |
| folders | 3 — `Стилі книги` 36, root 2, `Style Group 1` 2 |

## 2. n² is not a problem — I was wrong (Q2)

40 used styles give **780 pairs**. Not thousands. The estimate "pairwise
findings grow quadratically, and response size will become the phase's main
liability" is **refuted by measurement**: the pairwise pass costs nothing
here, and there are few findings.

Distribution of pairs by number of differing properties out of 12:

```
0 → 1     3 → 116    6 → 123
1 → 11    4 → 196    7 → 50
2 → 48    5 → 219    8 → 16
```

**Pairs that differ in EXACTLY one property — 11.** That's a workable number
for a report. But what matters is not the count, it's the pairs themselves:

| Pair | Difference | What it actually is |
|---|---|---|
| `Checklist R` / `Checklist L` | justification RIGHT / LEFT | **the whole reason both exist** |
| `Основний текст F` / `Основний текст L` | firstLineIndent 15.99 / 0 | F is the first paragraph, L is a regular one |
| `Підпункти … -1` / `Підпункти … - цифри` | listType BULLET / NUMBERED | **the whole reason both exist** |
| `Логотип` / `Підназва` | pointSize 10.5 / 20 | unrelated styles |
| `Анотація` / `Логотип` | justification | unrelated styles |

**A "styles differ in exactly one property" detector would report intent as
a defect** — the same class of failure that killed two Phase 13 detectors
(602 findings, zero defects). The only difference here is that it's quieter:
11 rows instead of 602. A quiet false-positive detector is worse than a loud
one.

## 3. The grouping "these styles SHOULD agree" cannot be derived (Q4)

Three candidate partitions, all measured:

| Partition | Groups ≥2 | Coverage | "differ by one" pairs within |
|---|---|---|---|
| folder | 3 | 40/40 | 10 |
| shared `basedOn` | 8 | 29/40 | 4 |
| first word of the name | 8 | 24/40 | 4 |

Folder covers everyone, but that's an illusion: **36 of the 40 styles sit in
the single folder `Стилі книги`** — a one-bucket partition separates
nothing. `basedOn` and name cover two-thirds and half respectively.

**So the "must agree" relationship cannot be derived from the document and
has to be DECLARED as a parameter** — the same conclusion already measured
for the bibliographic description standard and for the word-spacing density
threshold. This confirms the risk named before the probe rather than
refuting it.

## 4. There IS a natural gap, and it's sharp (Q5) — but behind it sit only four findings

Every numeric difference between pairs of used styles: **2029**. Sorted by
magnitude, they show exactly one order-of-magnitude jump:

```
0.004537 pt  →  0.331934 pt      gap ×73.2
```

Below the gap there are **exactly 4 differences, 4 style pairs**, and all
four are the same one:

```
«Підпункти в основному тексті -1»    firstLineIndent −15.9874015748031
«Підпункти в основному тексті - цифри»                −15.9874015748031
«Підпункт чеклисту Р2»                                −15.9828643798828
«Підпункт чеклисту стрілка»                           −15.9828643798828
                                              difference   0.0045 pt = 0.0016 mm
```

**0.0045 pt cannot be intentional** — that's 1.6 micrometers. Two families
of styles that should share an indent don't share it. This is a genuine
finding, and it's the only one.

Thresholds above the gap immediately turn into noise:

| Threshold | Differences | Unique pairs |
|---|---|---|
| ≤ 0.01 pt | **4** | **4** |
| ≤ 0.1 pt | 4 | 4 |
| ≤ 0.5 pt | 145 | 137 |
| ≤ 1 pt | 258 | 224 |
| ≤ 2 pt | 400 | 327 |

At 0.5 pt the detector reports `Анотація` 10.5 pt against `Пункт чеклисту`
11 pt — two unrelated styles with different point sizes. **137 findings,
zero defects among them.**

**A flaw in the probe itself, named rather than hidden:** the control for
"is this an mm→pt conversion artifact" checks whether the DIFFERENCE ITSELF
is round, and that's the wrong question — it's each of the two VALUES that
should be round. The control is uninformative as written; the conclusion
"0.0045 pt cannot be intentional" doesn't depend on it.

## 5. Utility styles pollute the population

`[No Paragraph Style]` (12 pt) and `[Basic Paragraph]` (11 pt) end up among
the 40 "used" styles and spawn dozens of pairs against every style in the
book. The `usage` family already has a separate path for them; block `S`
would need the same filter, or a utility style ends up the biggest
contributor to the report.

## 6. A convention detector — O(n), material exists, but the yield is small (Q6)

Properties where almost all styles agree, and a minority — 2–3 styles —
don't:

| Property | Agreement | Minority |
|---|---|---|
| `spaceAfter` | 40/40 = 0 | none at all |
| `rightIndent` | 38/40 = 0 | `Повідомлення від мам 1`, `2` (25.5 pt) |
| `listType` | 38/40 = NO_LIST | two list styles — **the whole reason they exist** |
| `spaceBefore` | 37/40 = 0 | `Повідомлення від мам 1`, `2`, `Заголовок 2 до інтерв'ю` |
| `tracking` | 37/40 = 0 | `Checklist R`, `L` (50), `Заголовок до чеклисту` (20) |

The remaining seven properties show no agreement (the modal value covers
11–33 of 40). So **the convention detector has five workable properties and
yields ~10 findings, almost all of which are visibly intentional** —
`Повідомлення від мам` are inset call-out blocks, the checklist's tracking
is a deliberate device.

That doesn't make the detector unfit: `styles_audit` is designed to **show
the fact and its location, not a verdict**. But as grounds for a dedicated
phase — weak.

## 7. The `fontStyle` trap is alive, and measured a second time (Q3)

Pairs with a differing `fontStyle` — 550, **of which 213 are between
DIFFERENT typefaces**. All 213 are false positives per the Phase 5
measurement (`SemiBold` = Proba Pro, `Semi Bold` = ZT Neue Ralewe; both
spellings are correct for their respective families). Phase 5's warning is
load-bearing, not decorative — but since the pairwise detector doesn't
survive anyway, the cost of this trap is now theoretical.

## 8. SUSPICION FELL ON THE INSTRUMENT — RESOLVED: the InDesign SESSION was at fault, not the code

**Resolved the same day by restarting InDesign.** On a fresh app instance,
same document, same handler:

| Run | Time |
|---|---|
| Phase 5, recorded ~3 weeks ago | 10,860 ms |
| fresh app, pass 1 | **10,716 ms** |
| fresh app, pass 2 | **10,602 ms** |

**There is no regression.** Phase 5's number reproduced to within 1.3% on a
newer InDesign (21.5.1.73) and a different edition of the book. Two
consecutive passes from a cold start show NO GROWTH (10.7 → 10.6 s).

**What this measurement does NOT prove, and it matters:** it doesn't
identify what exactly degrades speed over a long session. The probe's very
first call in the old session took 132 s — i.e. the degradation had already
accumulated BEFORE our calls, and our three passes drove it up to 318 s.
Two passes from a cold start aren't enough to reproduce the growth; how many
would be is not measured.

**An operational rule earned by this measurement, and binding for all
future phases: timing is only captured on a freshly launched InDesign.**
Numbers from a long session are wrong by a factor of 12–29. Any acceptance
criterion in milliseconds captured at the end of a work day is invalid.

Historical record of the measurements that raised the suspicion:

| Run | Time |
|---|---|
| Phase 5, `docs/measured-facts-phase5.md`, same operation | **10,860 ms** |
| probe `HS`, pass 1 | 132,539 ms |
| extra measurement, pass 1 | 264,886 ms |
| extra measurement, pass 2 | **318,074 ms** |

The numbers **grow monotonically within a single session** — 132 → 265 →
318 s. This is not a cold start and not a network file: both of those would
explain the first run, not every subsequent one. Small calls (`run_script`
reading a flag, `indesign_status`) remain instant throughout, meaning it's
specifically this handler that's slow, not the app as a whole.

The document here is also SMALLER than in Phase 5: 196 pages vs. 198, 2868
paragraphs vs. 2980.

The Phase 7 rule (**an order-of-magnitude discrepancy is grounds to suspect
the instrument, not a discovery**) worked here exactly as intended: the
suspicion did NOT become a conclusion, and the first cheap step — a
restart — found the cause. Had the monotonic growth been read as "regression
in `styles.jsx`," the phase would have gone bisecting merged code that has
no defect in it.

## 9. What follows for the phase

- **the "differs by one property" detector — DO NOT build it.** Measured:
  it reports intent (`Checklist R`/`L`, `Основний текст F`/`L`, the two list
  styles);
- **the "near miss" detector (< 0.01 pt) — build it, it's the only one
  proven out.** The ×73 natural gap is measured, and the threshold sits in
  the empty space between 0.0045 and 0.33 pt. Yield on this book — 4
  findings, one genuine cause;
- **the threshold CANNOT have a default**, same as Phase 13's
  `nearMissThresholdPt` and Phase 3's `SpacingOptions.mode`: 0.01 works
  here and is unknown elsewhere;
- **the "must agree" partition is a parameter, not a measurement;**
- **the convention detector — feasible, cheap, O(n), but the yield is ~10
  rows, almost all of which are intentional.**
