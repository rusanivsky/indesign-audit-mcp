# Measured facts, Phase 8 — probe `H8`

**Facts govern the spec, not the other way around.** Everything here was
obtained by execution on live InDesign 21.4.1.4, on **its own temporary
documents**, each closed immediately after measurement. No user document was
ever opened.

Instrument: `scripts/probe-h8-chain.jsx` (first round, Questions 1–5, 7) and
`scripts/probe-h8-restitch.jsx` (second round, Questions 2b, 3b, 4b, 7b),
both via `run_script` and **this branch's** `dist/bridge/runner.js` — the MCP
tools serve the main checkout's code, not the worktree's.

Date: 2026-08-08.

---

## Question 1: deleting a page from the middle — the thread REMAINS one story

An 8-page document, a helper frame on every page, all threaded into one
story. `doc.pages[3]` deleted.

| | frames on the layer | stories | pages | per page |
|---|---|---|---|---|
| before | 8 | `["265"]` | 8 | `1:1 2:1 3:1 4:1 5:1 6:1 7:1 8:1` |
| after | **7** | **`["265"]`** | 7 | `1:1 2:1 3:1 4:1 5:1 6:1 7:1` |

**InDesign re-threads its neighbors on its own.** The frame vanished along
with the page, the thread remained a **single** story with the same `id`,
and every remaining page has exactly one link.

**Consequence for the phase.** Deleting a page **does not** produce a gap
or a split. The state "167 frames on 196 pages," measured on the book,
comes not from deleting a page but from **adding** one (a new page gets no
link) — exactly the limit §6 of Phase 7 named: "coverage is complete AT THE
MOMENT OF THE OPERATION, not forever."

---

## Question 2: duplicating a page — the frame is COPIED, but NOT THREADED

The same document; `doc.pages[2].duplicate(LocationOptions.AFTER, ...)` run.

| | frames on the layer | stories | pages |
|---|---|---|---|
| before | 8 | `["265"]` | 8 |
| after | **9** | **`["265", "459"]`** | 9 |

Per page, after duplication — **one frame on each of the 9**.

The second round showed the breakdown by story (a 6-page document,
`pages[2]` duplicated):

```
before : 256[6]: 1,2,3,4,5,6
after  : 256[6]: 1,2,3,5,6,7  |  404[1]: 4
```

**THIS IS THE PHASE'S MOST IMPORTANT FACT, AND IT BLINDS TWO OF THE THREE
DETECTORS:**

- **`pagesWithoutFrame` is EMPTY** — every page has a frame;
- **the main story's order is MONOTONIC** — `1,2,3,5,6,7` never decreases;
- and yet the thread **is broken**: page `4` carries a frame in a separate
  story with one container, i.e. it has no previous frame, and the marker
  above it will print its **own** page (Phase 7's Question 10). Meanwhile
  pages `5,6,7` are taking their number from the frame on page `3` — the
  numbers have shifted by one.

**So the `folio-helper-chain-split` defect IS BORN**, and it isn't a
"fourth one just in case" — it's the **only** one that catches the single
most likely routine operator action. Task 4's gate (step 6) is closed
affirmatively by measurement, not by argument.

---

## Question 3: `nextTextFrame` on an ALREADY-THREADED frame — THROWS

A 6-page document, one continuous thread. An attempt to reorder the links
by direct assignment (`0→2`, `2→1`, `1→3`):

```
threadError      : "Invalid object for this request."
containersBefore : 6
containersAfter  : 6
pageOrderAfter   : 1,2,3,4,5,6
```

**An exception, and the thread didn't change at all.** The shape of repair
step 3 as the plan described it ("assign `nextTextFrame` in page order") is
**impossible**.

---

## Question 3b: unthread, then re-thread from scratch — WORKS

The same document. First `nextTextFrame = null` on every frame, then
re-threading in **reverse** page order (deliberately reversed — to make it
visible that WE set the order, not InDesign):

```
unthreadError : null
restitchError : null
framesAlive   : 6        (no frame lost)

before          : 256[6]: 1,2,3,4,5,6
after unthreading : 256[1]:1 | 412[1]:3 | 393[1]:2 | 450[1]:5 | 431[1]:4 | 469[1]:6
after rethreading  : 469[6]: 6,5,4,3,2,1
```

**Three conclusions, each needed by the handler:**

1. unthreading is **clean**: no error, the empty frames survive, each
   becomes its own story;
2. re-threading from scratch gives **exactly the order requested** — the
   thread's order really is controllable;
3. **the story order after unthreading does not match page order**
   (`256, 412, 393, 450, 431, 469` vs. pages `1,3,2,5,4,6`) — relying on
   `layer.pageItems` traversal order is unsafe anywhere.

---

## Question 4: `story.id` after a FAILED re-thread — unchanged

`storyBefore: "256"`, `storyAfter: "256"`, `changed: false`. Expected: the
thread never changed at all (Question 3 threw).

## Question 4b: `story.id` after a REAL re-thread — CHANGES

```
storyBefore : "256"
storyAfter  : "469"
changed     : true
```

**The repair makes the helper thread YOUNGER**, and that's exactly the side
Phase 7's §4.2 requires: InDesign picks the thread **created earlier**
(Question 9) as winner, and the helper thread must never override the
main one. The new `story.id` is larger than the old one, meaning the helper
thread loses to the main one after repair the same way it lost before it.
**This had to be checked precisely because the reverse result would have
made the repair dangerous**: it would have silently switched some folios
onto the helper source of the number.

---

## Question 2b: splicing a copy-frame into an existing thread — possible, but the order comes out wrong

A lone frame (its own story with one container), spliced in as a **tail**
onto the main story's last frame. `joinError: null`, i.e. assigning
`nextTextFrame` on a frame whose value is **empty** goes through — Question
3's prohibition applies only to an **already-threaded** frame.

```
after splicing: 256[7]: 1,2,3,5,6,7,4
```

**The order came out wrong** — page `4` became the last link. So "splice
without unthreading" doesn't save the repair: a **full** unthread-and-
rethread in page order is required. This confirms the shape of spec §4.3,
not a simplified one.

---

## Question 5: hide the layer and turn it back on

`afterHide: false`, `afterShow: true` — the flag reverts. **On its own this
measurement proves nothing** about marker resolution: Phase 7's Question 22
says that with two threads InDesign remembers the winner, and the flag says
nothing about that. Only the printed number (Task 11) provides proof.

---

## Questions 7 and 7b: cost of the pass — THE SPEC'S ESTIMATE IS WRONG

First round, a **quadratic** traversal (for every frame, loop over all
containers in its story), 24 pages, 5 passes: **371–380 ms**, i.e. ≈75 ms
per pass.

Second round, 100 pages, both shapes on the same document:

| Shape | Time | Work |
|---|---|---|
| quadratic | **4,231 ms** | 5,050 steps |
| **linear** | **257 ms** | 100 frames resolved |

**Spec §4.1 says "on the order of milliseconds against 820 ms for the whole
measurement." That is false.** The linear shape costs 257 ms on 100 pages,
i.e. about **500 ms** on a 196-page book — comparable to Phase 6's entire
measurement. The quadratic shape would cost about **16 seconds** on the
book, pushing the tool past the limit of usability.

**Two consequences, both mandatory:**

1. `IDMCP.measureHelperChain` **must** walk the story's containers **once**,
   building an `id → position` table, rather than looking up each frame's
   position separately. The quadratic shape isn't "slower" — it's unfit for
   use;
2. §4.1's cost figure in the spec is corrected to the measured one. An
   estimate in the document is a Global Constraints violation, which is
   exactly why this question was in the probe.

**The cost is paid only by documents where the layer EXISTS.** A document
without `_folio-helper` costs one `itemByName` + `isValid` and returns
`null`.

---

## Question 7c: the true cost — and it was THREE TIMES WORSE than the probe's prototype

Question 7b measured the **prototype** traversal, written inside the probe
itself. When the real `IDMCP.measureHelperChain` did the same work, it came
out to **866 ms** per pass (100 pages, 5 passes) instead of the expected
257. Same instrument, same document — so the difference comes from the
code, not the measurement, and that's where it had to be found.

**The source was found, and there's exactly one.** Breaking the same
traversal into parts (100 frames, 3 passes, `perPass`):

| Shape | ms |
|---|---|
| indexing the collection `layer.pageItems[i]` (as it was) | **773** |
| the same traversal via `everyItem().getElements()` | **22** |
| `getElements()` + `parentPage` on each | 9 |
| `getElements()` + `parentStory.id` on each | 10 |
| `everyItem().id` — all 100 ids in one call | **3** |

**Indexing a collection re-resolves it on EVERY access.** It isn't the
properties that are expensive — `items[i]` itself is. A **35x** difference
makes every other optimization of this pass insignificant.

Fixed in two places (`layer.pageItems` and `doc.pages`), and along the way
page names are taken from the already-read list rather than from
`frame.parentPage.name`:

| Revision | ms per pass, 100 pages |
|---|---|
| first (indexing both collections) | **866** |
| `getElements()` for the layer's frames | **270** |
| `getElements()` for pages too, names from the list | **143** |

**Bottom line: 143 ms on 100 pages**, i.e. ≈**280 ms** on a 196-page book —
about a third of Phase 6's entire 820 ms measurement. **A document without
the layer costs 1 ms** (20 calls in 20 ms).

**A rule broader than this phase:** in ExtendScript, cost is dictated not
by the number of properties but by the number of accesses to a
COLLECTION. One `everyItem().getElements()` up front costs less than a
hundred indexing operations.

---

## What follows from this for the phase

1. **A fourth defect, `folio-helper-chain-split`, IS BORN** (Question 2).
   It isn't an add-on — it's the only detector that catches page
   duplication, an action the operator performs routinely, after which the
   other two detectors stay silent;
2. **repair step 3 is "unthread ALL → re-thread in page order"**
   (Questions 3, 3b). Direct re-threading throws; partial splicing gives
   the wrong order;
3. **repair makes the thread younger, and that's safe** (Question 4b);
4. **the measurement must be linear** (Question 7b), and §4.1 of the spec
   is corrected;
5. **deleting a page does not break the thread** (Question 1) — the source
   of the book's measured "167 of 196" state must be sought in **adding**
   pages, not in deleting them. The investigation of the seven refused
   pages (Task 14) keeps this in mind.

---

## Detector mutants — proven by EXECUTION

`tests/unit/pagination-helper-chain.test.ts`, 19 tests. Each mutant was
introduced into the code, the tests were run, the result taken from the
output, the mutant reverted. Crediting a mutant with a result never
observed is a finding of the same rank as wrong code (in Phase 7, six
mutants survived and turned out to be findings **about the tests**).

| Mutant | What's broken | Result |
|---|---|---|
| M3 | `>` → `>=` in the order comparison | **1 failed** / 18 passed |
| M7 | thread breakage not checked (`if (false)`) | **5 failed** / 14 passed |
| M8 | order counted across the whole document, not within a story | **4 failed** / 15 passed |
| M9 | `chain === null` returns an empty chain instead of `[]` | **1 failed** / 18 passed |
| M10 | the first story is treated as the main one instead of the longest | **1 failed** / 18 passed |
| M11 | orphan frames are NOT excluded from the order check | **SURVIVED**, then — **1 failed** / 18 passed |
| control | code unchanged | **19 passed** |

M7 and M8 each break several tests — both break behavior described by more
than one assertion.

### M11 SURVIVED, and it's a finding ABOUT THE TEST, not about the code

The mutant "don't exclude orphan frames from the order check" passed green
on all 19 tests. In other words, the test "an orphan frame does NOT
participate in the order" proved nothing.

**The cause is in JS, and it isn't obvious.** `null` in a `>` comparison
coerces to zero. The test placed the orphan as the SECOND link, right after
a page with `offset = 0`:

```
0 > null   →   0 > 0   →   false     ← no false finding either with the filter or without it
```

An orphan produces a false finding only when it sits **after a page with
`offset > 0`**:

```
1 > null   →   1 > 0   →   true      ← the mutant reports a gap that isn't there
```

The test was moved to this placement — the mutant died (**1 failed**), the
control stayed green. This is the third phase in a row where a mutant finds
a flaw **in the tests**, not in the code, and the reason is the same each
time: the test fixture never contained the state under which the check
means anything.

---

## Audit response size — the threshold was crossed, as expected

| When | B | Threshold |
|---|---|---|
| Phase 7, Task 11B | 6,607 | 7,700 (1.17×) |
| **Phase 8, fourth detector** | **8,112** | **9,000 (1.11×)** |

**+1,505 B is two GROUPS, not per-page records.** The main fixture's
helper layer was deliberately left partial and hidden back in Phase 7
(state `folio-helper-layer-hidden`), so the fourth detector produces
`folio-helper-chain-hidden` there (one finding for the document) and
`folio-helper-chain-gap` on most of the 25 pages — and the report carries
two groups with a page list up to the `MAX_GROUP_PAGES` ceiling.

**The threshold was left TIGHT (1.11×), not doubled, and this is a
divergence from Phase 8's own spec §6, corrected within it.** Phase 5's rule
of "≈2× the measured value" was born where the threshold was a CEILING with
no measurement behind it, and the test passed the same with or without the
guard. Here it's the opposite: 7,700 against 6,607 is a tight threshold
that just fired and forced a decision to be made out loud. Raising it to
16,000 would make the guard vacuous in exactly the way Phase 5 warned
against.

---

## I8 — the report was silent about the layer, and the mutants confirmed it

Reproduced input: a second dry run on a copy of the book on 2026-08-08 gave
`alreadyAutomatic: 84`, `resolvedByHelper: 0` — and **not a word** about the
`_folio-helper` layer, even though all 84 markers depended on it.

**The root is structural, not cosmetic.** A frame already converted (no
literals) never gets a verdict **at all**, so `resolvedByHelper`, which
counts ELIGIBLE verdicts, is zero **by construction** — not because the
layer is unneeded.

The cure is **not a second counter**: a counter that can legitimately be
zero is the same channel that already lied. So the report now carries a
**restatement of the measurement** (`helperLayer`) plus a separate counter
of already-converted frames that depend on the layer.

| Mutant | What's broken | Result |
|---|---|---|
| M12 | the already-converted counter is always 0 | **1 failed** / 31 passed |
| M13 | `helperLayer` is always `null` | **1 failed** / 31 passed |
| M14 | the layer-cost warning is disabled | **4 failed** / 28 passed |
| control | code unchanged | **32 passed** |

---

## Measurement and repair mutants — also by execution

The same rules: mutant into the code, tests run, result taken from the
output, mutant reverted.

| Mutant | What's broken | Tests | Result |
|---|---|---|---|
| M1 | `pagesWithoutFrame` always `[]` | measure | **2 failed** / 38 passed |
| M2 | `helperChain` is never `null` (empty instead of "no layer") | measure | **1 failed** / 39 passed |
| M4 | repair step 1: a page's second frame isn't removed | repair | **1 failed** / 10 passed |
| M5 | repair doesn't restore the layer's visibility | repair | **1 failed** / 10 passed |
| M6 | the "foreign work on the layer" refusal is removed | repair | **1 failed** / 10 passed |
| M15 | repair ALWAYS rewrites the thread (no order check) | repair | **2 failed** / 9 passed |
| control | code unchanged | repair | **11 passed** |

**M15 deserves its own line.** It breaks no repair result — after it, the
thread is still just as intact, in the same order. What it breaks is
**only idempotency**: a second run stops giving zeros, because a full
unthread-rethread cycle creates a new story (Question 4b). In other words,
without an idempotency test this defect would be **invisible in the
result** — but it would cost a `story.id`, a `modified` flag, and an undo
step on every no-op run.

---

## Question 6: PROOF BY THE PRINTED NUMBER — and it found a bug

`scripts/probe-h8-printed.mjs`. An 8-page document, a helper thread on
every page, folio "⟨previous⟩–⟨current⟩" sitting **exactly on top of** the
helper frame. The page count is **deliberately** left unchanged: it's the
THREAD that's broken, not the layout, otherwise a character-by-character
match would be impossible by construction.

### GAP state — a link removed from the middle

```
REFERENCE : 1-1 | 1-2 | 2-3 | 3-4 | 4-5 | 5-6 | 6-7 | 7-8
BROKEN    : 1-1 | 1-2 | 2-3 | 3-4 | 5-5 | 4-6 | 6-7 | 7-8
AFTER     : 1-1 | 1-2 | 2-3 | 3-4 | 4-5 | 5-6 | 6-7 | 7-8
```

The break shows on **two** pages, and both look plausible: page 5 prints
"5–5" (no previous frame — prints its OWN page, Phase 7's Question 10),
page 6 prints "4–6" (its previous frame is now on page 4). After repair —
**a character-by-character match with the reference**.

### SPLIT state — a link unthreaded from the chain

```
REFERENCE : 1-1 | 1-2 | 2-3 | 3-4 | 4-5 | 5-6 | 6-7 | 7-8
BROKEN    : 1-1 | 1-2 | 2-3 | 3-4 | 5-5 | 6-6 | 6-7 | 7-8
AFTER     : 1-1 | 1-2 | 2-3 | 3-4 | 4-5 | 5-6 | 6-7 | 7-8
```

Here too two pages lie, both in the "N–N" shape. After repair — a
**character-by-character match**.

### THIS PROBE'S FIRST RUN FAILED, AND THAT'S THE MAIN THING IT PRODUCED

In the GAP state, repair **did not restore** the numbers: page 5 kept
printing "5–5" despite a flawless report (`+1 link`, the thread continuous,
one story, correct order).

**Cause: the probe was passing the handler an empty `folioFrameIds`.**
Without geometry donors, the spliced-in link lands in the page's corner
(`helperFallbackBounds`) and **does not overlap the folio**, meaning the
marker has nothing to resolve against.

**This is exactly the failure mode the whole phase is built against:**
repair fixed the **THREAD** and did not fix the **NUMBER**, while every
measured signal said "intact." None of the four detectors would have seen
this state — from their point of view the thread is flawless.

The tool always passes donors (`measure.folioFrames`, excluding master
ones, hidden ones, and any with unknown bounds), so this defect is absent
along the operator's path. But relying on that silently isn't acceptable,
so the following were added:

- **a test-level guard** — the repair integration test now requires
  `created[0].source === "folio"`, not just "a link was spliced in";
- **an explanation right next to the handler's code**, with this
  measurement attached.

---

## Investigation of the seven refused pages — the cause found, and it's one cause for all seven

Run on a copy of `Book 260807-2100 copy.indd` (196 pages, 2026-08-08).
A dry run of `create-helper-thread` reproduced Phase 7's numbers exactly:
91 claims, **84 eligible**, **7 `no-neighbour-frame` refusals** on pages
`101, 109, 153, 167, 171, 185, 195`.

### What's wrong with them — nothing

| Trait | All seven |
|---|---|
| own folio frames on the page | **1** (none of the book's pages has two) |
| side | RIGHT_HAND, the correct spread neighbor |
| manual number | equals the previous page |
| auto-marker | present |
| layer | "Шар 1," visible |
| `current` / `expected` in the oracle | **match** |

So the oracle resolves on them, and the reason for the refusal isn't the
number.

### Cause: `route` comes out `thread`, not `helper`

```
p.101  {"reason":"no-neighbour-frame","route":"thread","current":100,"expected":100}
p.103  {"eligible":true,               "route":"helper","current":102,"expected":102}
```

The difference is in the overlaps. Eligible p.103 has **one, master**
overlap (`fromMaster: true`), meaning `documentThreadLinks` filters it out
— there's no document thread under the frame, route `helper`. p.101 has
**two** overlaps, one of them **a document one** (`fromMaster: false`,
layer "Шар 1"). By Phase 7's §4.2 the main thread overrides the helper, so
the route is forced to `thread` — and in that frame `previousPage: null`,
because its story has **one container**. There's no neighboring frame,
hence the refusal.

### What this frame is

Identical on all seven pages:

```
2 characters "’’", style [Basic Paragraph], layer "Шар 1",
containers in the story 1, size 150 pt, font Apple Symbols Regular
```

**This isn't clutter — it's a deliberate layout element.** Each of these
seven pages ends with a quote and its attribution ("Марія, мама Вікторії та
Артура," "Аліна, мама Марії," …), and a large **closing quotation mark**
sits as its own frame. It prints — it's visible in the reference PDF at the
tail of the page's text. Apple Symbols as the edition's third typeface and
150 pt quotation marks are already a known deliberate device in this book.

### And this connects to a Phase 7 measurement nobody had linked to the refusals

The overlap between the quotation mark and the folio is **126.22 × 0.00
mm** (on p.185 — 244.05 × 0.00; on p.195 — 134.23 × 0.00). So along one
axis this is a **TOUCH**, not a true overlap.

Phase 7's Question 3 measured exactly this and recorded it as an
instrument property:

> "of the 7 existing contacts between the folio and a thread on the
> working book, `touch` — **7**, `strict` (intersection area > 0) — **0**"

**Those "7 contacts" are exactly these seven pages.** Phase 7 counted them
while proving that a touch must count as an overlap, and never noticed
that these same seven would later produce seven refusals. The number "7"
sat in two different sections of the phase, and nobody named the link
between them.

### What to do about it — a human decision, not the tool's

- **leave it as is.** The seven folios stay manual, and the audit doesn't
  stay silent about them: they remain in `folio-manual`. The cost is seven
  numbers that don't update themselves;
- **nudge the quotation mark** by a fraction of a millimeter so it stops
  touching the folio frame. The route would then become `helper`, and the
  seven would become eligible alongside the 84. This is a LAYOUT change,
  and the tool must not make it — §2 of the phase forbids that outright.

**The tool is behaving correctly, and its refusal here isn't a loss of
coverage — it's a refusal to record a marker that would print its own page
instead of its neighbor's.**

---

## Run on a copy of the working book — §8.5 acceptance criterion

Copy `Book 260807-2100 copy.indd`, 196 pages, 2026-08-08, InDesign
21.4.1.4. Calls made through **this branch's** registered tool
(`scripts/run-book-phase8.mjs`), not through `mcp__indesign__*`. The
working book was never opened.

State of the copy at the start — **pre-Phase-7**: no thread, nothing
converted.

| Step | Result |
|---|---|
| **1. audit before** | 160 claims, **deviating 0**, `folio-manual` 91, `folio-dormant-duplicate` 29. Findings about the thread — **zero** — no layer, the detector stays silent |
| **2. reference PDF** | 196 pages captured |
| **3. `create-helper-thread`** | 196 links, 91 from folio geometry, `ignoredFolioFrames` 0, `becameOverset` empty, `pageCountDelta` 0 |
| **4. PDF after building it** | **0 differences** from the reference |
| **5. audit** | deviating 0, findings about the thread zero |
| **6. `replace-literals`** | `applied 84`, `failed 0`, all 84 `resolvedBy: helper` |
| **7. PDF after the replacement** | **0 differences** from the reference across all 196 pages |
| **8. BREAK IT** | one link removed from p.50 (196 pages, 195 links) |
| **9. audit** | **deviating 2**: `folio-helper-chain-gap` on **p.50** and `folio-marker-cross-spread` on **p.51** |
| **10. PDF of the broken state** | exactly 1 difference: p.51 "50–51" → **"49–51"** |
| **11. repair** | 1 link spliced in (p.50), 195 links rewritten, 196 links on 196 pages |
| **12. PDF after repair** | **0 differences** from the pre-break PDF AND **0 differences** from the original |
| **13. audit** | deviating **0**; `folio-dormant-duplicate` 29 and `folio-manual` 7 remain — neither is a discrepancy |
| **14. repair run again ×2** | `removed 0, added 0, rewritten 0` both times |

### What this run proved, and what no fixture-only test had proven

**The detector names the CAUSE, not just the effect.** Before Phase 8, step
9 would have produced one finding — `folio-marker-cross-spread` on p.51,
i.e. "a number has drifted." Now `folio-helper-chain-gap` sits right next
to it on **p.50**, and that's the address to go fix. This is exactly the
answer that was missing from the incident that started the phase.

**Building the thread on THIS book is neutral on the sheet.** §6 of Phase 7
warned that `create-helper-thread` might change printed numbers on pages
whose marker previously had nothing to resolve against. On the book this
didn't happen (0 of 196): all 29 such frames sit on the hidden
"Нумерація" layer and don't print. This is a measurement, not a refutation
of Phase 7 — on the fixture the state is different.

**`folio-manual` dropped from 91 to 7, exactly on the converted ones**, and
the seven that remain are the same seven refused ones (see the section
above). The arithmetic balances with nothing left over.

**Idempotency on the real document**, not just on a fixture: two repeat
repairs in a row gave straight zeros.

### Found by the RUN, not by tests: the report was denying its own work

The first wet `create-helper-thread` returned **`helperLayer: null`**
immediately after having created a layer with 196 frames. The cause was the
same as in I8: the block was built from `measure`, and the measurement
happens **before** the write. Fixed (the block is now built from the
handler's own report), closed with a test and a mutant.

**In other words, the run on the book again found a defect that 1,431
green unit tests and 262 integration tests never saw.** The third phase in
a row with the same result.

---

## One undo step — PROVEN BY EXECUTION, not left "for manual checking"

Phase 7 recorded this property as unverified: "`doc.undo()` cannot be
called from the script, the probe only proved the step's NAME." The
phrasing turned out too broad. Calling `doc.undo()` **from within its own
step** throws (Question 12); called SEPARATELY, i.e. from the outside, it
works — the fixture handler `__undo_once` has existed for this since Phase
4.

Test `tests/integration/pagination-repair.test.ts`, state
`helper-chain-duplicate-on-page` — chosen deliberately, because there
repair does **three** different things (removes a frame, keeps coverage
complete, re-threads the chain):

| Step | Measured |
|---|---|
| before repair | 7 links |
| repair | `removed 1`, `restitched 5` → 6 links |
| **one** `doc.undo()` | **7 links, and all seven `frameId`s are the same as before repair** |
| step name at the top of the stack | `"Ремонт службового ланцюжка"` |

**Had there been several undo steps, one undo would have reverted only the
last of them** — the removed frame would not have come back. The name
check stands on its own: without it the test would have stayed green even
if undo had rolled back something else and the frame count matched by
coincidence. A mutant ("wrong step name") confirmed this (**1 failed**,
control green).

**Incidentally disproves a Phase 4 worry** ("InDesign session state makes
`doc.undo()` impossible if a second document is open"): the test passed
with a copy of the working book open at the same time.

### What's left to the user

Nothing mandatory. Backups from before every change sit in `_backups/`
next to the document; rotation keeps the last ten.

---

## Final review — three findings, all of the same class

A review of range `8a2b6d9..HEAD`, done by reading the code, not by
paraphrasing its own claims about itself. All three are a **fabricated
signal** — the failure mode §3 calls worse than a missed defect: the
operator goes off to fix something that isn't broken.

| # | Finding | Why it's a fabricated signal |
|---|---|---|
| 1 | `orderInStory === -1` wasn't excluded from the order check | "position wasn't set" sorts FIRST, so a link with a large `pageOffset` would become the thread's start, and the next comparison would produce `folio-helper-chain-unordered` across the entire thread |
| 2 | `storyId === ""` wasn't excluded from the split check | an empty string isn't a story name, it's the absence of one; one such link would become its own "story," i.e. it would produce `folio-helper-chain-split` exactly where the measurement simply failed |
| 3 | the `refusedToRemove` field in the repair response | it is **always empty**: foreign work on the layer stops the operation with an EXCEPTION before the copy is made, so the response is never even built. An empty array reads as "checked, and found nothing" — exactly the same substitution of "not measured" for "measured and empty" that the phase is built against |

**Fixed:** 1 and 2 — with a shared `measured()` predicate, plus an
explanation of why this is a filter rather than a fifth defect (both states
are unreachable by any known path, and turning an unobserved state into a
finding is the same mistake Phase 7's §4.9 avoided with `layerPrintable`);
3 — the field was removed from both the response and the spec, and the
list of offending elements now rides in the error message's own text.

**Proven by mutants:** "don't filter out unmeasured ones" →
**2 failed** / 19 passed; control green.
