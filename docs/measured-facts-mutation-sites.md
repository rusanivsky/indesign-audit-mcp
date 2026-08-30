# Measured facts: mutation sites and rollback

Probes run 2026-08-17, InDesign 21.5.1.73, on OUR OWN empty documents
(`app.documents.add()`, closed with `SaveOptions.NO`). No working files were
opened. Both questions were raised by `docs/аудит-мутуючих-місць.md`.

## Question 1: does `doScript(…, ENTIRE_SCRIPT)` roll back on an exception

**IT ROLLS BACK. COMPLETELY.**

The probe and its controls:

| Measurement | Value |
|---|---|
| `textFrames.length` INSIDE `doScript`, before the throw | **1** (id 243 read back) |
| `textFrames.length` after the exception | **0** |
| the same action WITHOUT an exception (positive control) | **1** |

In other words the frame really did exist — it wasn't "never created" — and
disappeared specifically because of the exception; without the exception the
same sequence leaves it in place. Two of the three numbers here are
controls, and without them a green zero would mean anything at all.

**Consequence, and it reverses my own fix.** The message from repair step 3
(`src/jsx/pagination-write.jsx`) said "the operation was rolled back
entirely." I had judged this to be false, from two true premises:
`IDMCP.withUndo` has no `undo()` of its own, and no one in the project had
ever measured rollback-on-exception. The conclusion doesn't actually follow
from those premises — **InDesign rolls back the step itself**, and the
original sentence was true. The fix has been reverted, and the reason is
recorded here, because the mistake was methodological: I read "not measured"
as "doesn't happen."

**What rollback does NOT cover:** a forced app quit, a crash, or a process
killed by timeout mid-way through a re-threading loop. In those cases there
is no exception, so no one ever sees the message either, and the chain is
left broken — "N–N" instead of "170–171." That is the one scenario where
step 3 is genuinely dangerous.

## Question 2: does `layer.pageItems` see master-page items

**IT DOES NOT.**

| Measurement | Value |
|---|---|
| frames created on layer `_zond-layer` | 2 (one on the page, one on the master) |
| `f2.itemLayer.name` (the master's frame) — control | **`_zond-layer`** |
| `layer.pageItems.length` | **1** |
| `masterSpreads[0].pageItems.length` | 1 |
| `pages[0].pageItems.length` | 1 |

The control is mandatory: without checking `itemLayer.name`, the number 1
could equally be explained by the master's frame simply having landed on the
wrong layer.

**Consequence:** the concern raised in `docs/аудит-мутуючих-місць.md` is
resolved. An empty master-page frame on a utility layer will **not** be
classified as `orphan` and will **not** be deleted by the repair — it is
invisible to it entirely. The same blindness applies to the re-check, so
there is no gap between what it promises and what it does.

This is consistent with what was already measured in Phase 13 ("`layer.pageItems`
only counts the top level") and in Phase 14 ("masters bypass `allPageItems`"):
document-level master collections don't show them, and this is a third
independent measurement of the same limitation.

## Question 3: what happened to the folio layer — STEP 2, DONE

Nine files were opened read-only (`app.open(f, false)`, closed with
`SaveOptions.NO`, `NEVER_INTERACT`), nothing was saved. Measured: page
count, total character count across all stories, `_folio-helper` layer
links, how many of them have no page (`parentPage === null`), and how many
pages are left without a link.

| File | mtime | pages | chars | links | orphans | pages w/o link |
|---|---|---|---|---|---|---|
| `…_do-pravok_2026-08-15-2007` | 08/15 23:07 | 196 | 219,190 | **0** | — | layer empty |
| `…_do-pravok_2026-08-15-2126` | 08/16 00:26 | 196 | 219,190 | 196 | 0 | 0 |
| `…_do-pravok_2026-08-15-2139` | 08/16 00:39 | **198** | 219,063 | 196 | 0 | — |
| `…_do-pravok_2026-08-15-2145` | 08/16 00:45 | 198 | 219,063 | 198 | **1** | — |
| `Book 260811-1645.indd` | 08/16 12:47 | 196 | 219,063 | 196 | 0 | 0 |
| `Book 260816-1250.indd` | 08/17 11:21 | 196 | 219,061 | 196 | **169** | **169** |
| `Book 260817-1120.indd` | 08/17 12:24 | 196 | 219,064 | 196 | **169** | **169** |
| `Book 260817-1230.indd` (copy) | 08/17 12:43 | 196 | 219,063 | 196 | 0 | 0 |
| **LIVE `260817-1230.indd`** | 08/17 18:26 | 196 | 219,065 | 196 | **0** | **0** |

**THE DAMAGE WAS REAL, AND IT WAS ALREADY FIXED.** In two files — `260816-1250`
and `260817-1120` — **169 of 196 links ended up with no page**, i.e. sitting
on the pasteboard, and exactly as many pages were left without a link. The
live file and the `260817-1230` copy are clean.

**The chain itself was NOT broken**: 195 links out of 195 in every file where
links exist. So the frames weren't deleted or re-threaded — they **lost the
page underneath them**. This is not the scenario I was worried about when
reading step 3's code.

**No mass text loss occurred.** 219,190 → 219,063 (−127 characters) between
00:26 and 00:39 on the night of Aug 15→16 corresponds to a `corrections_apply`
run, and 127 characters is consistent with ordinary edits. After that the
count holds within ±2 characters all the way to the live file.

**OUR MUTATING TOOLS WERE NOT RUNNING IN THIS WINDOW.** Every one of them
drops a copy into `_backups` before writing; between `260811-1645.indd`
(08/16 12:47, clean) and `260816-1250.indd` (damaged) **there are no copies
at all** — no `_do-pravok_`, no `_do-kolontsyfr_`, no `_page-numbers_`. So the
damage happened outside of them. The most likely mechanism (a hypothesis,
not a measurement): pages were reordered or deleted, and the utility layer's
frames stayed at their absolute positions and drifted off the pages. The
intermediate state of 198 pages on the night of Aug 15→16 shows that pages
in this book really were being moved around.

### Our audit DOES see this state, and that has been verified on the damaged file itself

`pagination_audit` on `260816-1250.indd` (`folio: {styleName: "Колонтитул v1"}`):

```
checked 131, deviating 247
  folio-helper-chain-gap   169 pages
  folio-marker-unbound      78 pages
```

The finding's own text names both the cause and the fix: "Most likely
cause — a page was added after the chain was built… Fix: pagination_apply
with operation: 'repair-helper-thread'."

The same audit on the **live** file: `checked 132, deviating 0`.

**Conclusion for the print gate:** the preflight run catches this defect —
and would have caught it back then, had it been run. This is the most
direct evidence of the CLI's value gathered so far: not a fixture, but real
damage in a real book.
