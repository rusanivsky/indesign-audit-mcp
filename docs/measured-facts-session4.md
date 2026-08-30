# Measured facts — session 4 (2026-08-18)

Everything here is **measured**, not derived from reading the code. Every
block names the instrument, the document, and the date; where a
measurement refuted the plan, that's stated directly.

InDesign 21.5.1.73 across all runs.

---

## 1. `TextPath` is not a `PageItem`. It's a CLASS, not a stray line

**Instrument:** `scripts/probe-textpath.jsx` + `scripts/probe-textpath.mjs`
**Document:** «02 Зоряні Мрії 2022 Print 3 copy.indd», 592 pp.
**Traversal time:** 1,267 ms for 164 stories

```
724 containers in story.textContainers:  720 TextFrame  +  4 TextPath
properties on TextFrame — 137, on TextPath — 35
```

`TextPath` has NONE of `PageItem`'s properties. They throw (all 4 of 4
containers, message "Object does not support the property or method"):

| property | where our code was reading it |
|---|---|
| `parentPage` | `map.jsx:551` — the FIRST failure |
| `rotationAngle` | `map.jsx:558` — the SECOND failure, after the "fix" |
| `geometricBounds` | `composition.jsx:62`, `cli-extras.jsx:53` — third in line |
| `itemLayer` | `color.jsx:127` |
| `visibleBounds` | — |
| `textFramePreferences` | `composition.jsx:63` |

Read normally: `id`, `previousTextFrame`, `nextTextFrame`, `overflows`,
`parent`, `characters`, `lines`, `paragraphs`, `insertionPoints`,
`textColumns`, `contents`, `parentStory`, `textStyleRanges`.

The **carrier** of these properties is the graphic object that owns the
path (`container.parent`; in this book all four are `Oval`). Everything
reads on it except `textFramePreferences`, and its `parentPage` is the
REAL text page:

```
story:21  id=4985   → p. 592      story:103 id=58594 → p. 1
story:22  id=5009   → p. 592      story:104 id=58619 → p. 1
```

`textFramePreferences` exists on NEITHER the container NOR the carrier —
it's a property of a text frame, not of a page item. Neither one has
insets or columns for text-on-a-path.

### Why this killed two attempted fixes

`ed2c666` fixed `parentPage` — the exception moved to `rotationAngle`, on
**the same object**. Next in line were `geometricBounds` and `itemLayer`.
There's no way to count them in advance from the code; the only option is
to name the class and route every such read through a single gate
(`IDMCP.pageItemOf`).

### Classify by reading, not by class name

`hasOwnProperty` on DOM properties works correctly — measured:

```
tf.hasOwnProperty("parentPage") → true      tp.hasOwnProperty("parentPage") → false
tp.hasOwnProperty("contents")   → true
```

But the code instead attempts a READ: it answers exactly the question
being asked, and doesn't depend on `constructor.name`, which is unreliable
in ExtendScript. Success with a `null` value (the pasteboard) is also a
success: it proves the object IS a page item.

### An incidental measurement

A regular frame's `tf.parent` is a **Spread**, not a Page. For the path's
owner the chain is `Oval → Group → Group → Spread`. There is no
`doc.textPaths` collection (`owner.textPaths.length` — does exist).

---

## 2. `layout_measure` on 592 pages: 928 s, and this is the FIRST complete number

**Run:** 2026-08-18, after the §1 fix

```
bootstrap.jsx  01:38:37
result.json    01:54:05     → 928 s
ok: true · 592 pages · 297 spreads · 164 stories
724 frames · 21,686 paragraphs · 15,751,836 bytes
unplacedContainers: 0 · unplacedParagraphs: 0 · frames without a page: 0
```

**The "511 s" from the 2026-08-17 run is NOT a previous value for this
figure** — that was the time BEFORE THE FAILURE on `rotationAngle`. The
pass had never once run to completion on this book, so "it got slower"
can't be said: there's nothing to compare against.

Precision to the second — from file mtimes: the `osascript` client gave up
at 900 s, while InDesign carried the work through to the end and wrote the
result. The number includes JSX module loading, so it's more of an upper
bound on the traversal itself.

The cap was raised from 600,000 to 1,800,000 (1.94x over the measured
value). The CLI's `timeoutHintMs` for the `layout` pass stood at
**420,000** — below the tool's own cap, and even below the 476 s seen on
the 198-page book: the CLI was cutting the tool off before the tool cut
itself off.

Extracted numbers — `docs/прогони/istoriya-layout-2026-08-18.summary.json`
(the full 15.7 MB `result.json` is not committed to the repo).

---

## 3. A foreign master: the target was FOUND, not constructed

**Instrument:** `scripts/probe-foreign-master.jsx`
**Documents:** both versions of робочої книжки, 196 pp. each, 12 masters
**Time:** 3,019 ms for both documents
**Read-only proven:** `modified false→false` on both, both opened windowless
and closed with `SaveOptions.NO`

The "page → applied master" maps differ in **EXACTLY ONE spot**:

```
p. 188   broken: G-Шаблон без колонтитулів
         current: J-Розділ 3 текст колонтитули
```

One difference across 196 pages — and it's exactly the incident the author
named ("forgot to reassign the parent template"). This is a rare case for
the project: the right answer was obtained INDEPENDENTLY of the detector.

The neighborhood of p. 188 (LEFT_HAND, across runs):
```
182-186 ×3 J  |  188 ×1 G  |  190-192 ×2 J
```

### The measurement refuted the plan TWICE

**1. "Inside a LONG uniform run" — the run is NOT long.**

| `minRun` | candidates across 196 pp. | target |
|---|---|---|
| 1 | 16 | present |
| **2** | **4** | **present** ← used |
| 3 | 0 | **ABSENT** |

A stricter threshold rejects the exact case the detector was written for.
And `minRun = 1` is noisy in a specific way: **10 of its 16** candidates
are two deliberate ALTERNATIONS (`J/N` on pp. 164-170 and `D/M` on pp.
119-125), i.e. the "chapter text — checklist" rhythm.

**2. Matching sets of paragraph styles does NOT strengthen a candidate.**
Jaccard similarity to both neighbors (averaged) across the four candidates
at `minRun = 2`:

```
p. 188 — 0.191   ← the GENUINE defect
p. 167 — 0.125
p. 108 — 0.292
p.  49 — 0.393
```

The target sits **in the middle** of the range. There is no threshold in
either direction that would isolate it: "higher than X" would drop it
along with p. 167, "lower than X" would drop it along with p. 108 and p.
49. So the style set does not enter the detector AT ALL — not as a gate,
not as a weight.

### The cost of measuring this — zero

The plan pointed at `document_map` (928 s, §2). Not needed: `PageRef.master`
is already collected by `pagination_measure`
(`src/jsx/pagination.jsx:1303`). The detector is a pure function over
numbers that already exist.

### What turned up along the way

p. 167 has **the same shape** as the target (`G` inside a run of `J`), and
in the CURRENT file it's still `G`. Either a deliberate separator or a
second forgotten template — the tool names both and decides neither.

Master distribution (broken file): `F-Шаблон інтерв'ю` 78, `J` 25, `E` 23,
`G` 16, `D` 16, `H` 10, `N` 10, `C` 6, `I` 5, `M` 4, `A` 3.

---

## 4. The old `folio` shape IS caught — but not by the layer I first looked at

Three config shapes run through both tier-1 layers:

| Shape | `validateConfig` | `reconcileWithToolSchemas` |
|---|---|---|
| `folio: { styleName: "…" }` | passes | **rejected**: "expected array, received undefined" |
| `folio: "string"` | passes | **rejected**: "expected object, received string" |
| `folio: { styleNames: […] }` | passes | passes |

**My own measurement mistake, worth remembering.** The first probe called
ONLY `validateConfig`, saw "passed" on both old shapes, and nearly produced
the conclusion "tier 1 doesn't catch the old shape." It does — but it's
`reconcileWithToolSchemas`, a separate function the probe never called.
Half the instrument is not the instrument; this is the same class of
mistake as the "511 s" in §2.

Consequence: `styleName` and `styles` in `КЛЮЧІ_СТИЛІВ` were **ghosts** with
no protective role, and safe to remove.

---

## 5. An environment trap, caught this session

**A killed client does NOT stop InDesign, and the next call fails with a
SYNTAX error.**

A `layout_measure` run exceeded the `Bash` timeout (10 min) and the process
was killed. InDesign kept running the script regardless. The next call
produced:

```
IndesignError: Помилка виклику InDesign:
74:80: syntax error: Expected end of line but found "script". (-2741)
```

This is **not** a code defect and not a corrupted `APP_TARGET`. A busy
InDesign doesn't respond to `ascr/gdte` terminology, AppleScript is left
without the app's dictionary, and `do script` stops being a recognized
command — hence the syntax error landing precisely on the word "script"
(position 74-80 falls exactly on it, character for character).

The tell for recognizing this: `tell application id "…" to name of active
document` first hangs, then answers after 10.4 s. Once InDesign is free —
the same command answers in 0.17 s.

**Practical consequence:** run long passes in the background
(`nohup … &`) and wait for the process to finish, rather than bounding
them with a shell timeout. Killing the client doesn't stop the work — it
only makes you lose sight of its result.

---

## 6. What this produced in code

| handoff § | state | where |
|---|---|---|
| §1 | closed, proven by a live run | `IDMCP.pageItemOf`, `inspect.jsx` |
| §2.1 | closed | `pageNameFor` built ON TOP OF `parentPageOf` |
| §2.2 | closed | `unplacedContainers`, `unplacedParagraphs`, `unmeasured: text-path` |
| §2.3 | closed DIFFERENTLY than the review asked | `IDMCP.rejectUnknownParams` — a gate on the KEY, not on emptiness |
| §2.4 | closed | a gate in the `pagination_apply` handler + 3 tests on the key |
| §2.5 | closed | two ghosts removed, the guard's reverse direction added |
| §2.6 | closed | `IDMCP.pageResolution` — three states instead of two |
| §2.7 | closed | `conflictingStyles` + a loud rejection |
| §3.1 | closed | `numberingGaps` → "needs eyes" |
| §3.2 | closed; **geometry already worked** | `color.caveat` and `composition.warnings` are now read |
| §3.3 | closed, in the live config too | gate + `configs/example-textbook.json` |
| §3.4 | closed | the promise replaced with advice backed by numbers |
| §4 | closed | `src/pagination/master-island.ts` |

### What the review failed to anticipate

- **§2.3**: it proposed throwing on an empty `folioStyles`. That would have
  broken `pagination_audit` on every edition without folio numbers —
  `src/tools/pagination.ts:714` sends `[]` precisely when the family isn't
  declared.
- **§3.2**: `geometry.anchorRule` was already reaching the report
  (`src/geometry/report.ts:244` → `d.notMeasured` → the CLI adapter).
  There was nothing to change.
- **§3.2, more broadly**: the `composition_audit` adapter returned
  `notSeen: []` and NEVER read `d.warnings` — meaning neither an
  incomplete traversal, nor a fallback hyphen-character width, nor
  uncalibrated styles ever reached the report. This is more than what the
  review named.
- **§3.3, deeper**: the silent state was being handed out by the
  SCAFFOLDER ITSELF (`scaffoldConfig` produced `sequences: { rules: [] }`),
  and `незаповненіМісця` never saw it — an empty array of markers contains
  nothing. And it sat inside the live `configs/example-textbook.json`.

---

## 7. The foreign-master detector found a defect ON A SECOND BOOK — on its first run

**Run:** 2026-08-18, `pagination_audit` on «02 Зоряні Мрії 2022 Print 3
copy.indd» (592 pp.). The detector was written and calibrated on
робочої книжки and had never once seen this book.

**Candidates across 592 pages: two.** Both are the same pair of pages:

```
p. 551 (recto)  «E-Географічний» inside a run of «D-Іменний»  (run 27/4)
p. 552 (verso)  «E-Географічний» inside a run of «D-Іменний»  (run 27/3)
```

### What this actually is — measured, not guessed

The master map across the index zone:

```
517-549  D-Іменний        ← name index
551-552  E-Географічний   ← TWO PAGES OF A FOREIGN MASTER
553-559  D-Іменний        ← name index CONTINUES further
560-571  E-Географічний   ← the geographic index REALLY starts here
572-576  F-Переглянуті
```

So two pages in the middle of the name index are dressed in the geographic
index's template, and the geographic index itself starts nine pages later.

### What this prints

The running header on LEFT-hand pages names the section. Measured
page-by-page:

```
p. 546  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 548  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 550  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 552  E-Географічний   «ГеографічниЙ ПОКАЖЧИК»   ← WRONG
p. 554  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 556  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 558  D-Іменний        «ІМЕННИЙ ПОКАЖЧИК»
p. 560  E-Географічний   «ГеографічниЙ ПОКАЖЧИК» + a heading in the body
```

**Page 552 prints "GEOGRAPHIC INDEX" in the middle of the name index.**

### Why this would have made it to print

On RIGHT-hand pages both masters produce the same running header — the
publication's title ("Зоряні Мрії. 2022: бібліографічний покажчик").
Measured: p. 551 with the foreign master looks exactly like p. 549 and p.
553 with their own. The error is visible on exactly ONE page of the
two-page spread — precisely the class of thing a visual proofread misses.

### What this means for the detector

A detector calibrated on one book (target: p. 188 of робочої книжки) found a
defect of the same class on a DIFFERENT book on its first run, and
produced zero false candidates in the process: both of its hits are the
same single genuine defect, seen from both sides of the spread.

**A boundary worth naming:** a run-break that falls on a spread produces
TWO entries (one per side), not one. This isn't duplication — the two
sides are judged independently by construction — but a report reader needs
to understand that "2 candidates" here means "one location."

**The decision belongs to a person.** The tool doesn't know whether these
two pages were meant to be the start of the geographic index and later got
moved, or whether this is a plain oversight. It names the location.

---

## 8. A FULL CLEAN RUN OF "ІСТОРІЯ" — 13 of 13, and timing cannot be trusted

**2026-08-18, 11:48:41 → 12:15.** Nothing was rebuilt during the run.
Artifacts: `docs/прогони/istoriya-2026-08-18-clean.{html,summary.json}`.

```
✓ status        0.4 s      ✓ bibliography   48 s
✓ overview      1.6 s      ✓ spelling       41 s
✓ preflight    11.3 s      ✓ layout        657 s
✓ color        98 s        ✓ composition   292 s
✓ geometry      4.8 s      ✓ extras        128 s
✓ typography   35 s
✓ styles      253 s        ✓ pagination     42 s
```

**13 of 13.** Header: "Clean 3 · Not seen 40 · Needs eyes 11" (it used to
be 10 of 13 and "2 · 35 · 9"). This is the run §5 of the handoff never had.

The §2.2 counters are present and zero — i.e. all 724 containers, including
the four `TextPath`s, did land on a page:

```
layout.totals.unplacedContainers: 0   unplacedParagraphs: 0
extras.unresolvedItems: 0
```

### THIS PASS'S TIMING IS NOT REPRODUCIBLE — and that's the section's headline number

Two runs of the SAME code on the SAME book, an hour apart:

| pass | run 11:23 | run 11:48 | ratio |
|---|---|---|---|
| preflight | 0.7 s | 11.3 s | **15.4x** |
| layout | 336 s | 657 s | **1.95x** |
| composition | 413 s | 292 s | 0.71x |
| bibliography | 88 s | 48 s | 0.55x |
| extras | 78 s | 128 s | 1.65x |
| color | 96.9 s | 98.5 s | 1.02x |
| styles | 240 s | 253 s | 1.05x |

**THE HYPOTHESIS WAS REFUTED BY MEASUREMENT.** Seeing 336 s against the
overnight 928 s, I assumed this was the effect of the "three `parentPage`
calls → one" fix (§9 below). A second run of the SAME code gave 657 s. In
other words the spread between runs of identical code is larger than any
effect that could be attributed to the fix: **928 / 336 / 657 are three
measurements of one quantity, not a story of improvement.**

What follows from this in practice:
- the `layout` cap of 1,800,000 stays correct: 928 s was observed, and the
  spread is high;
- passes cannot be compared across runs at all — neither toward "got
  faster" nor toward "got slower";
- only heavy passes with a large constant factor are stable (`color`
  1.02x, `styles` 1.05x). Light ones (`preflight` 15.4x) aren't worth any
  conclusion.

### The first attempt that same day was CORRUPTED, and the cause was methodological

The 11:23 run was still going when I rebuilt `dist` at 11:30. Node was
already holding the TypeScript modules in memory, while **JSX is read from
disk on EVERY call** — so the later passes ran NEW JSX against OLD
TypeScript. That's exactly why `unplacedContainers` never showed up in that
run's `layout.totals`: the code was correct and built, but that process
never saw it.

**Rule:** don't touch `dist` while a run is in progress. A mixed build
doesn't fail — it silently hands back numbers from two different versions.

---

## 9. The WRITE path: my reasoning was refuted by measurement TWICE in a row

After `parentPageOf` learned to use the graphic owner, I checked whether
behavior had changed on the MUTATING path (`replaceFolioLiteral`,
`pagination-write.jsx`). Both of my pieces of reasoning turned out false.

**Reasoning 1:** "`doc.pageItems.itemByID` can't return a `TextPath` —
that's not a page item." Measured:

```
itemByID(4985).isValid              → true      ← TextPath's id
getElements()[0].constructor.name   → TextPath
itemByID(999999999).isValid         → false     ← CONTROL, confirms this is real
```

It can. `pageItems` returns it as a generic `PageItem` specifier, and
`getElements()` strips the wrapper and reveals the real class.

**Reasoning 2:** "`isTextFrameLike` will filter it out." Measured:

```
itemByID(4985).paragraphs.length    → 1         ← the predicate LETS IT THROUGH
itemByID(4985).parentPage           → THROWS
itemByID(4985).contents             → "• ВИДАВНИЧИЙ •"
```

It doesn't filter it out: `isTextFrameLike` asks specifically about
`paragraphs`, and text-on-a-path has those.

### What followed from this

Before the fix, `TextPath` was filtered out BY ACCIDENT: `parentPageOf`
returned `null`, `pageName` didn't match the measured page, and the frame
got rejected with "layout changed since the measurement" — a correct
result for the WRONG reason. Since `parentPageOf` learned about the owner,
the page now DOES match, and the accidental guard is gone.

So an EXPLICIT gate with a named reason was added to `replaceFolioLiteral`.
The cost of a mistake here is asymmetric: this is the write path, and a
miss would mean a folio marker written into decorative text on a curve.

**A lesson broader than this one case:** when a fix changes the behavior of
a function the WRITE path reads, reachability cannot be reconstructed by
reasoning — it has to be measured. Two pieces of reasoning in a row sounded
convincing, and both were wrong.

---

## 10. `===` on a DOM object — a trap, and the rule has to be stricter than the trap itself

**Found by a failure, not by reading.** The integration suite (35 files)
caught a regression that the 2640 unit tests DO NOT see: in the vm sandbox
the comparison works, because there the objects are ordinary ones.

`IDMCP.resolveContainerPage` began with `container === null || container
=== undefined`, outside any `try`. On live InDesign this throws:

```
TextFrame.===() cannot work with instances of this class
```

Consequence: `pagination_apply` could not write a single fix. 15
integration tests went red.

**The earlier implementation avoided this trap BY ACCIDENT:** before
2026-08-18, `parentPageOf` went straight into a `try` and compared nothing.
The refactor introduced a comparison that had never existed in the code
before.

### Measured: the trap is INCONSISTENT

A temporary document, created and closed without saving:

```
TextFrame === null                 → false    works
TextFrame === undefined            → false    works
TextFrame === Oval                 → false    works
itemByID specifier === null        → false    works
specifier === ITSELF               → THROWS
!specifier                         → false    always works
specifier ? 1 : 0                  → 1        always works
```

So `=== null` on a DOM object sometimes works and sometimes throws,
depending on how the object was obtained. **There is no safe subset worth
memorizing.**

**RULE: never use `===`/`!==` on DOM objects at all — only truthiness
(`if (x)`, `x ? a : b`).** This is deliberately stricter than the measured
trap: I tried to reason out the trap's boundary three times in one day,
and got it wrong three times.

### A/B, not a guess

Put the same line back — the failure reproduced with the same text and the
same address. Put `!container` back — 4 of 4 green. Causation proven by
execution.

### The exception's address now travels in the report

The catch in the write loop was keeping only `.message`, discarding `.line`
and `.fileName`. "TextFrame.===() cannot work with instances of this
class" is true, and impossible to locate from. With the address, the same
run pointed straight at `inspect.jsx:129`.

### The same pattern was removed in ten more places

Outside a `try` (crash risk): `color.jsx`'s `colorHostOf`;
`pagination.jsx` — `parentPage`, `parentStory`, `itemLayer` ×2, and a
`finally` that restores `rulerOrigin` (an exception there would have masked
the real error).

Inside a `try` (worse — a SILENT wrong answer): `pagination-write.jsx` ×3,
where the exception produced not a crash but "no frame with that id."

Verified with the full integration suite: **35/35 files, 333/333 tests,
496.7 s.**

---

## 11. The foreign-master detector — END TO END on live documents

Unit tests proved the PURE FUNCTION against a measured map, and the
stitching to the report was checked against synthetic data. The full
chain — live `pagination_measure` → `detectMasterIslands` → the
`pagination_audit` response — had NEVER once been run. Closed 2026-08-18:
both files opened without saving, measured through the tool's real
handler, and closed with `SaveOptions.NO`.

```
[BROKEN]   Book 260816-1250.indd     masterIslands: 4
    p. 49  RIGHT  «E-Розділ 1…»   inside «F-Шаблон інтерв'ю»   (run 2/3)
    p.108  LEFT   «D-Розділ 2…»   inside «F-Шаблон інтерв'ю»   (run 2/3)
    p.167  RIGHT  «G-Шаблон без…» inside «J-Розділ 3…»          (run 2/2)
    p.188  LEFT   «G-Шаблон без…» inside «J-Розділ 3…»          (run 3/2)  ← TARGET

[CURRENT]  Book 260817-1230 copy.indd  masterIslands: 3
    p. 49 · p.108 · p.167                    — p.188 IS GONE
```

The numbers match the fixture-based unit test down to the exact candidate.
This is the strongest control possible: the two files differ by EXACTLY
ONE page, and that is precisely the one that disappears, with the other
three staying put.

### An incidental measurement worth noting

`pagination_audit` MARKS THE DOCUMENT AS MODIFIED. On the broken file
`modified` went false → true; on the current one it stayed false. The
reason is documented in the code: the measurement temporarily writes
`viewPreferences.rulerOrigin` and restores it in `finally`, but only writes
it when the origin isn't already `SPREAD_ORIGIN`. Nothing is written into
the layout; but an operator who sees "document modified" after an audit
should know where it comes from.

### The §7 trap, caught a second time — now from the opposite side

The on-disk file path is in **NFD**. Measured:

  · ExtendScript's `new File(path)` finds the file when given **NFC**;
  · Node's `fs.readdirSync`/`existsSync` on that same NFC path gives
    **ENOENT**.

So the two sides of the bridge normalize differently, and a path that
works in JSX may not work in Node. The reliable approach is to take the
bytes straight from the filesystem (`find -print0`), rather than typing
the name by hand.
