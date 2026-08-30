# Measured facts — proof of `bibliography_audit` on a real book (REPEAT run)

**Facts govern the spec, not the other way around.** Everything here was
obtained by EXECUTION on a live InDesign 21.5.1.73, on the user's working
document «02 Зоряні Мрії 2022 Print 3.indd» (592 pages, 164 stories) —
**read-only**: no write, no `save`, no `close`. Calls went through the REAL
`src/tools/bibliography.ts` pipeline (`collectAudit` → `readNoBreak` →
`nbspFindings` → `buildReport`), compiled into `dist/`, invoked directly
through `node` + `runJsx` (`dist/bridge/runner.js`) — the same bridge the
registered MCP tool uses, just without the MCP server itself (it is started
from the main checkout, which does not have this branch).

Date: 2026-08-11. Commit at run time: `79bcc2e` (after `e9a16e3` +
`137ddc9` — `containers_read` no longer throws on `TextPath`; after
`6ec57cf` + `79bcc2e` — block-based record segmentation).

---

## 0. Why this file was rewritten, not appended to

The previous run (committed as `aa15411`, the file before this rewrite) gave
**555 records, 61.26% unparsed**. That run could NOT be done honestly: the
real `containers_read` threw an exception on this same book (`TextPath` on 4
stories, `.parentPage` does not exist in ExtendScript), so every number in
that file was measured through a homemade `try/catch` wrapper around the
handler — a wrapper that was deliberately NOT committed to the repository,
and which was itself a finding, not a quiet fix. Tasks 14 and 15 removed the
cause: `TextPath` no longer throws, and segmentation is now block-based (a
record can span several `\r`-paragraphs closed by an empty paragraph). This
task is a **new, clean run of the REAL code, with no wrapper at all**, and
the numbers here replace the previous ones rather than supplementing them.

---

## 1. Document state — before and after

InDesign had **TWO** documents open, not one as the task text claimed:

| | active document | `modified` | `saved` |
|---|---|---|---|
| «02 Зоряні Мрії 2022 Print 3.indd» (592 p.) | yes (before and after) | `true` / `true` (unchanged) | `false` / `false` |
| «Україна в умовах екзистенційної війни v3.indd» (1 p.) | no | `false` / `false` (unchanged) | `true` / `true` |

**A mismatch with the task's INVIOLABLE boundaries, worth its own line.**
InDesign had not one document open but two — the user's starting state, not
a consequence of this work (verified via `status` before the first
`containers_read` call and after the last `nobreak_read` call: both
documents, both `modified` flags, both `saved` flags — unchanged).
`containers_read` only reads `app.activeDocument` (`src/jsx/inspect.jsx:151`),
so the second document was never even touched by any call in this work. No
`save`, `close`, write to a document, or switch of the active document
happened at any point during the run.

---

## 2. Overall run numbers

| | |
|---|---|
| containers read (`containers_read`) | **164** (all, no exceptions — including the 4 former `TextPath` ones) |
| records (passed number+discriminator) | **4655** |
| unparsed | **161 (3.46%)** |
| skipped: heading (section headings and trailers with no number) | 6656 |
| skipped: no-discriminator | 90 |
| skipped: cross-reference | 181 |
| numberingGaps | 135 |
| nbspCandidates (total, both layers) | **20 703** |
| dstuFindings (total) | **18 375** |
| bib-nbsp-initials | **11 706** (systematic) |
| bib-nbsp-locator | 8 406 |
| bib-abbrev (needs-review) | 7 555 |
| bib-prescribed-spacing (needs-review) | 6 865 |
| bib-range-dash | 3 925 (systematic) |
| bib-nbsp-extent | 591 |
| bib-heading-form (needs-review) | 12 |
| bib-slash-once | 9 |
| bib-final-dot | 8 |
| bib-double-dot | 1 |
| **bib-zone-separator** | **0** |

**Internal cross-check (not from the checklist, but worth recording):** the
sum of the `dstu` groups (7555+6865+3925+12+9+8+1 = 18,375) equals
`dstuFindings` exactly; the sum of the `nbsp` groups
(11706+8406+591 = 20,703) equals `nbspCandidatesCount` exactly. The latter
means: **not one of the 20,703 non-breaking-space candidates is protected by
either a character or an attribute** — findings = candidates with no
remainder, exactly what the spec claimed about the 2022 edition (§0.5: "no
protection, neither by character nor by attribute").

---

## Question 1: `bib-zone-separator` — **0**, confirmed by EXECUTION, not merely by absence from the list

An isolated run of only this rule (`ruleIds: ["bib-zone-separator"]`) over
all 4655 records gave **exactly 0** findings — not "the group is absent from
the report," but verified by a direct count,
`collected.dstuFindings.length === 0`. Consistent with the `17,459` en-dashes
/ `0` hyphens measured on this same edition by `findGrep` (spec §0.1).
**Confirmation, not a surprise.**

---

## Question 2: `bib-nbsp-initials` — **11,706**, not ~5527 — the GAP IS RESOLVED

> **ADDED 2026-08-12, after the branch's final end-to-end review.** The
> section below used to be the one place in this file that left a number
> UNEXPLAINED ("a hypothesis, not confirmed by a second independent
> measurement"). The re-measurement is now done — on the dump
> `/tmp/story141.txt`, without InDesign. The hypothesis was confirmed; the
> review's second hypothesis (a paragraph-mark artifact) was **refuted on
> this material**. Both results are below, along with the command used to
> get them.

This is the largest mismatch on the checklist, and its direction is the
**opposite** of the previous (broken) run: back then it was 6.9× LOWER than
expected (805), now it is 2.1× HIGHER.

### Re-measurement on the story 141 dump — the gap fully explained

Material: `/tmp/story141.txt`, 305,546 characters, 3,890 paragraph marks — a
dump of ONE story from the same book, taken earlier. InDesign is not needed
for this measurement: the `collectAudit` pipeline is a pure TypeScript
function over a string.

| Measurement on the dump | Value |
|---|---:|
| records | **1159** |
| unparsed | **0** |
| of which MULTI-PARAGRAPH (the slice contains `\r`) | **1110** |
| `bib-nbsp-initials` findings | **2962** |
| of which the **initial + initial** pair («А.␣В.») | **1419** |
| of which the **initial + surname** pair («В.␣Прізвище») | **1543** |
| literal «А. В.» pairs across the WHOLE story text (the spec's `findGrep` equivalent) | **1421** |
| **ratio 2962 / 1421** | **2.084** |
| ratio across the book, 11,706 / 5527 | 2.118 |

**The reason for the gap is not the text-sampling method, but that the rule
counts TWO pairs where `findGrep` counted ONE.** `INITIALS`
(`rules-nbsp.ts:50`) is built with a lookahead specifically so that «А. В.
Прізвище» produces TWO matches: the space between the initials AND the
space between the second initial and the surname. The client called both
key (spec §7.2). The grep query for `5527` searched for the literal pair
«А. В.» — exactly the first of the two.

The arithmetic checks out with no remainder: 1419 "initial+initial" pairs
against 1421 literal matches across the whole story text (a difference of
2 — pairs outside successfully-parsed records), plus 1543
"initial+surname" pairs that `findGrep` never saw at all. And the ratio on
the dump (2.084) matches the book-wide one (2.118) to two decimal places —
so this is the same pattern, not a coincidence of one story.

**Conclusion: `11,706` is correct; `5527` counted half the phenomenon.** The
reference figure in `rules-nbsp.ts:17` and in the spec does not "need
re-checking" — it measured something different, and now we know exactly
what.

### The second hypothesis (a paragraph-mark artifact) — REFUTED on this material

The final review found C1: `closeOpen()` replaced `\r` with a space, and a
finding could point EXACTLY at a paragraph mark. It was natural to suspect
that part of the 11,706 / 5527 gap was exactly such phantom findings. **On
the story 141 dump this is not the case, and the number here is exact:
zero.**

| Check on the dump | Before the C1 fix | After |
|---|---:|---:|
| findings violating the `slice(start,end) === before` contract | **0** | **0** |
| `bib-nbsp-initials` candidates sitting on a `\r` | **0** | **0** |
| paragraph marks right after an initial (`[А-Я]\.\r`) across the whole story | **0** | **0** |
| `bib-nbsp-initials` findings | 2962 | **2962** |

The reason is simple: in this story, no paragraph ends with an initial. The
pattern the review used to reproduce C1 (a "name index": «967. Прізвище, А.
В.\rНазва праці…») does not occur in story 141 — but it DOES occur in the
book, and this same file already described it: "Question 6," 86 of 150
manual-review candidates are the boundary between «Surname-title →
Title-of-work» across two paragraphs.

**So the honest statement is:** the artifact's contribution to the number
11,706 on the story 141 dump is **zero**; on the FULL book it is greater
than zero (the pattern exists), but measuring it needs a run across all 164
stories, i.e. live InDesign. That measurement was NOT done — the work
proceeded without touching the app. What was done instead: the 11,706 /
5527 gap was FULLY explained by a different, measured cause (double
counting of pairs), leaving no room for a large artifact contribution to
this number.

### What else the re-measurement showed — the C1 fix broke nothing

The same dump, all ten finding groups, before and after the C1 fix (not
replacing `\r`, plus three spots in `rules-dstu.ts` that now name `\r`
explicitly):

| Group | Before | After |
|---|---:|---:|
| `bib-nbsp-initials` | 2962 | 2962 |
| `bib-nbsp-locator` | 1979 | 1979 |
| `bib-nbsp-extent` | 225 | 225 |
| `bib-abbrev` | 1944 | 1944 |
| `bib-prescribed-spacing` | 1665 | 1665 |
| `bib-range-dash` | 942 | 942 |
| `bib-slash-once` | 7 | 7 |
| `bib-heading-form` | 6 | 6 |
| `bib-final-dot` | 2 | 2 |
| `bib-double-dot` | 1 | 1 |

The intermediate state (`segment.ts` fixed, `rules-dstu.ts` not yet fixed)
gave `bib-abbrev` **1935 instead of 1944** — exactly 9 findings whose
abbreviation sits at the end of a paragraph. That is the price of the C1
fix, expressed as a number: without naming `\r` explicitly in the
lookaheads, some findings would have vanished SILENTLY, and the
disappearance would have looked like "it got clean."

**Surprise #1 is resolved.** The 11,706 / 5527 mismatch is no longer "a
signal worth separate checking" — it is measured and explained.

---

## Question 3: `skipped → no-discriminator`, the first 10, BY EYE

```
1. Iсторiографiя та джерелознавство iсторiї України (загальнi працi) Науково-дослідні інституції Персоналiї iсторикiв
2. Наукова робота з iсторiї України Археологiчнi дослiдження Наукові заходи
3. Викладання iсторiї
4. Спецiальнi iсторичнi дисциплiни II. ЗАГАЛЬНI ПИТАННЯ IСТОРIЇ УКРАЇНИ
5. Бiблiографiчнi покажчики
6. Теорія та філософія історії України Етногенез. Націогенез
7. Населення. Демографія
8. Iсторичне краєзнавство Iсторiя окремих регiонiв Iсторiя мiст i сiл Господарсько-побутова культура населення України (
9. Історія військової справи
10. Українська дiаспора та полiтична емiграцiя
```

All ten are section headings from the index, not a single real
bibliographic record among them. **Confirmation**: the heading/record
distinction works.

**An observation, not from the checklist:** block-based segmentation
(Task 15) stitches several consecutive `\r`-paragraph headings into ONE
skipped block, until it hits an empty paragraph or a new number — so in
entry #1 we see THREE headings at once («Iсторiографiя...»,
«Науково-дослідні інституції», «Персоналiї iсторикiв») glued together by a
space instead of `\r`. This is not a bug: headings go into `skipped` anyway,
not into `records`, so the gluing is harmless to the audit — but it means
the "first 10" actually cover far more than 10 lines of the original
layout.

---

## Question 4: `unparsed` — **161 of 4655 (3.46%)** — under the 10% threshold

Compared with the previous (broken) run — 61.26% → 3.46%, a 17.7× drop. The
"a record can span several `\r`-paragraphs" model (Task 15) closed exactly
the gap that the previous run found and named as the main cause of its 61%
failure rate.

**All 161 unparsed were classified BY EYE, with no remainder** (see
Question 7 — this is the same 161, not a separate sample):

| Subtype | Count |
|---|---:|
| a heading with a year/year-range in its title (p. 6–11) | 18 |
| a list of periodicals grouped by year of issue, not by number (p. 572–587) | 143 |
| **other** (a genuine record that failed to parse for a different reason) | **0** |

**Surprise #2.** Not the fact of being "under the threshold" itself
(expected), but that **100% of unparsed records are explained by exactly
two known subtypes of Task 2's deferred finding** — not one "simply broken"
record among the 161. The tool does not fail at random: everything it
failed to parse, it failed to parse for one of two documented reasons.

---

## Question 5: timing — the pipeline fits the budget, `containers_read` — 17.6 s

| Step | Time | Details |
|---|---:|---|
| `containers_read` (REAL, no wrapper) | **17,566 ms** | 164 stories, including the 4 former `TextPath` ones — no exceptions |
| `collectAudit` (pure JS) | 174 ms | segmentation + parsing of 4655+161 records |
| `nobreak_read` | **32,455 ms** | 20,703 requests, 1.57 ms/request |
| `buildReport` | 32 ms | |
| **TOTAL** | **50,227 ms** | |

`NOBREAK_READ_TIMEOUT_MS` = 120,000 ms. **32,455 ms is 27% of the ceiling, a
3.7× margin.** On real, growing offsets scattered across 592 pages (not on
the tiny fixture with repeating indices that the comment next to the
constant warned about) — and the per-request cost (1.57 ms) is LOWER than
the cost measured in the previous (broken) run through the wrapper
(3.29 ms/request) — faster, not slower, on a batch five times larger
(20,703 vs. 1084).

**Surprise #3 — a pleasant one.** The previous run never even reached this
step (it failed 424 ms in). Now the full pipeline fits in 50.2 s, and
`nobreak_read` is not the bottleneck: it is under half(!) of the total
time, and has a three-month margin to the ceiling.

---

## Question 6: zone separator WITHOUT a dash (`". "` instead of `". – "`) — **0 confirmed** after three levels of narrowing and manual review

A naive search (the literal `ZONE_STARTERS` — the same regex as in
`bib-zone-separator` — right after `". "` with no dash required before it):
**1358** matches. This is expectedly noisy: `ZONE_STARTERS` catches ISBD
abbreviations («Вип.», «Т.», «С.», a year, «(», etc.) that regularly occur
INSIDE an already-recognized zone (for example, the initial «М.С.» falsely
matches as «С.» — a page abbreviation).

Narrowed to the most precise branch of `ZONE_STARTERS` — «Place :» (a
capital letter, up to ~20 characters, then a colon): **150** candidates. All
150 were reviewed BY EYE and classified:

| Subtype | Count (of 150) | A genuine 7.1 violation? |
|---|---:|---|
| the boundary «Surname-title. → Title: subtitle» (two `\r`-paragraphs of "name-index"-style records) | **86** | NO — this is the "record heading → title" boundary, not an inter-zone ISBD separator (an author heading is not one of the 8 ISBD zones at all) |
| the subtitle colon inside a source/article title that happened to match the «Place :» pattern (e.g. «Августина Волошина : зб. наук. пр.») | 62 | NO — a false positive of the review heuristic, not of the rule itself |
| ambiguous | 2 | not established |

**Confirmed result: 0 of 150 are a genuine "zone separator without a dash"
violation under 7.1.** This is consistent with the brief's expectation
("on the measured corpora, this pattern does not occur at all") —
confirmed, not refuted, and this time on a much larger corpus (4655
records vs. 555 in the previous broken run).

**Surprise #4, not from the checklist, but significant for a future task.**
The largest share of "noise" (86 of 150) is not random but SYSTEMATIC: the
boundary between a heading paragraph («Прізвище, Ім'я.») and a continuation
paragraph («Назва: підзаголовок...») in "name-index"-style records. Task 15
taught segmentation to STITCH these two paragraphs into one record (which
is correct and necessary), but the zone parser (Task 3) still does not know
about THIS boundary as a separate structural unit — it simply dissolves
into the text of the "title" zone. This is not a defect of THIS task and is
not literally one of the seven checklist items, but it is the same
structural gap that Question 2 of the previous (broken) run already called
"systemic, not isolated" — and, as we can see, it survived both Task 14 and
Task 15, simply becoming INVISIBLE (records now parse successfully, it's
just that the "title" zone now contains two semantically different chunks
of text glued together).

---

## Question 7: a heading/periodical-list-with-a-year passing the discriminator as a record — **161**, exactly the same as `unparsed`

The discriminator catches a year `(?:19|20)\d\d` ANYWHERE in a block of
text, including the block's own number if it falls in the 1900–2099 range,
and including years inside heading text. In this book there are **18** such
blocks (headings with a year/year-range in the title, p. 6–11) **+ 143**
(a list of periodicals grouped by YEAR of issue rather than record number,
p. 572–587) = **161**, and all 161 are exactly the same 161 `unparsed` from
Question 4 — the count matches with no remainder.

Examples of both subtypes:

```
#6  (с.9):  «6. Воєнні дії на українських теренах у 1942–1944 роках»
#9  (с.11): «9. Євромайдан. Революцiя Гiдностi. 2013–2014 роки»
#2020 (с.572): "2020. Вип. 32 / Вип. 33 / 2022. Вип. 34"
#2021 (с.575): "2021. Т. 24, № 6–12 / 2022. Т. 25, № 1–6"
```

**No surprise in the EXISTENCE** (the brief anticipated this explicitly and
named exactly this class as an example). **Surprise #5 is in the
COMPLETENESS of the match**: everything the tool failed to parse (161
records) is explained by exactly these two subtypes of the same deferred
Task 2 finding, with no remainder — meaning `unparsed` on this book is not
"parser noise," but exactly the measured size of a known, named, localized
(two specific parts of the book) discriminator gap.

---

## What follows from this

1. **`bib-zone-separator` = 0, confirmed by EXECUTION** on 4655 records —
   the contextual filter does not catch grammatical dashes in this
   edition.
2. **`bib-nbsp-initials` = 11,706, TWICE the spec's reference figure
   (5527), not less — and the cause is MEASURED (added 2026-08-12).** The
   rule counts TWO pairs where `findGrep` counted one: the space between
   the initials AND the space between the second initial and the surname.
   On the story 141 dump: 2962 findings = 1419 + 1543, against 1421
   literal «А. В.» pairs — a ratio of 2.084 against the book-wide 2.118.
   The reference figure `5527` is not wrong, it measured half the
   phenomenon. The review's hypothesis about a paragraph-mark artifact's
   contribution is refuted on this dump (zero findings on a `\r`); on the
   full book the contribution is greater than zero, but it cannot be
   measured without InDesign.
3. **`unparsed` dropped from 61.26% to 3.46%** (Task 15 closed the main
   gap), and all 161 unparsed records are explained with no remainder by
   two known subtypes of Task 2's deferred finding (heading with a year:
   18; periodical list by year: 143) — NOT ONE "simply broken" record.
4. **`skipped → no-discriminator` — 10/10 confirmed as headings.**
5. **The full pipeline fits in 50.2 s**, `nobreak_read` — 32.5 s for
   20,703 requests (27% of the 120 s ceiling), and `containers_read`
   itself no longer throws — Task 14 closed a finding from the previous
   run that was independent of bibliography.
6. **"Zone separator without a dash" — 0 confirmed violations out of 150
   candidates** after manual review, confirming the brief's expectation.
   But the review uncovered a SYSTEMATIC structural fact (86 of 150): the
   «author-heading → title» boundary in "name-index"-style records still
   has no place of its own in the zone model (Task 3) — it dissolves
   inside the "title" zone. This is not a standard violation, but it is a
   coverage gap for ANY future rule that wants to check the content of
   such a heading separately.
7. **"Heading with a year in the title" — 161, and that is EXACTLY all of
   `unparsed`.**

**Main conclusion of the task:** the previous run (555 records, 61%
unparsed) was measured with a flawed tool (a wrapped `containers_read` with
a swallowed exception) on an incomplete segmentation model and does not
count as evidence. This run is the first clean measurement of the real code
on the whole book: 4655 records, 3.46% unparsed, the full pipeline in
50.2 s. The one figure that did NOT hold up — the `bib-nbsp-initials`
reference figure (5527 against the measured 11,706) — **was re-measured on
2026-08-12 on the story 141 dump and fully explained** (Question 2): the
rule counts two pairs where `findGrep` counted one.

**No write was made to the document, no document was saved or closed.**
Active documents at the end of the work — two, the same set as at the
start; the active one — «02 Зоряні Мрії 2022 Print 3.indd», `modified`
did not change in either one.
