# Measured facts — Chicago bibliographic description, before any code

**Facts govern the spec, not the other way around.** Everything below was
obtained by EXECUTION against a live InDesign 21.5.1.73 on 2026-08-27,
through the registered MCP tools, on the user's working English print
edition — **read-only**: no write, no `save`, no `close`.

Branch head at run time: `0b846cf`. The MCP server runs from the main
checkout, so every tool call exercised `main`, not this worktree.

---

## 0. Document state — before and after

Two documents were open, both English, both untouched:

| document | pages | `modified` before / after | `saved` before / after |
|---|---|---|---|
| «…260821-1200-EN.indd» | 184 | `false` / `false` | `true` / `true` |
| «…260821-1200-EN-print.indd» | 196 | `false` / `false` | `true` / `true` |

**One state change is ours and must be named:** the ACTIVE document was
switched to the print edition via `windows[0].bringToFront()`, because
every audit tool reads `app.activeDocument` only and the print edition is
the 196-page one the measurements are about. `app.activeDocument = doc`
would have done nothing — activity lives on the WINDOW, not on the
document. No other state was altered.

The Ukrainian edition was NOT open during this run. Any claim about it
below is therefore "not measured", not "clean".

---

## 1. The existing ДСТУ pipeline finds nothing to judge

`bibliography_audit standard=7.1` on the print edition:

| | |
|---|---|
| `records` | **0** |
| `unparsed` | 0 |
| `skipped` reason `heading` | **1866** |
| `skipped` reason `no-discriminator` | **132** |
| `groups`, `uniformity`, `warnings` | all empty |

**This is construction, not accident.** `segmentContainer`
(`src/bibliography/segment.ts`) opens a record only on a paragraph matching
`DEFAULT_RECORD_PATTERN` — `^\s*(\d{1,5})\.\s+(?=[…A-Z…])`. A Chicago
bibliography is unnumbered and alphabetical. With no number there is no
open record, so every paragraph falls out as `heading`, and the
discriminator never gets a block to test.

Consequence for the plan: the earlier working assumption — "run the existing
audit on the English list and see what it BREAKS" — has no answer, because
it breaks nothing. It parses nothing. A Chicago standard needs a new
**segmenter**, not just a new rule family.

---

## 2. The only real bibliographic record in the edition

`story:245`, page 4, verbatim (`\r` = paragraph mark, `\n` = forced line
break inside a paragraph):

```
Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. — <U+0018> p.
```

Its structure is ГОСТ 7.1 throughout: inverted surname without a comma,
author repeated after ` / `, zone separator « . — » with an en dash in
spaces, and a space before the colon in `City :`.

### `U+0018` composes to the right number

The extent field is not a literal — it is `U+0018`, InDesign's page-number
marker, the same character that stands twice in `story:250` (`<U+0018>–<U+0018>`,
page 107). The suspicion was that on page 4 it would compose to «4».

**Disproved by rendering the page.** `page_render page=4` shows
`— 196 p.` The marker resolves to the last page number. The extent is
correct and must not be "fixed".

---

## 3. There is no bibliography in this book at all

GREP over the whole print edition through `text_find mode=grep`:

| pattern | matches |
|---|---|
| `Bibliography` (plain) | **0** |
| `References` (plain) | **0** |
| `(Sources\|Further reading\|Literature\|Works Cited\|Notes)` | **0** |
| `(https?://\|www\.\|et al\.\|, (19\|20)\d\d\.)` | **3** |

All three of the last are inside the technical data, and none of them is a
citation:

| container | text | what it is |
|---|---|---|
| `story:245` | `, 2026.` | the CIP record's year of publication |
| `story:248` | `, 2026.` | «Signed to press <the signing date>.» |
| `story:248` | `, 2026.` | the publishing-entity certificate date |

**So a full Chicago standard has exactly ONE record of real material in
this edition.** Every rule beyond the imprint will be exercised only by
fixtures. The repository holds no English bibliographic corpus either: all
13 `tests/**/bibliography-*.test.ts` files are synthetic, and the one real
corpus ever measured (`docs/measured-facts-bibliography.md`, 592 pages, 555
records) is Ukrainian ГОСТ 7.1 material.

The mitigation chosen is to take fixtures from the Chicago Manual of
Style's own published specimen entries rather than to invent them. A
specimen printed by the standard is evidence; an entry invented to pass a
test is not.

---

## 4. The full imprint block, page 4

Rendered and read, in reading order:

| container | content | verdict |
|---|---|---|
| — | `УДК <classification>` + author's mark | Ukrainian cataloguing reqs, confirmed by the author — NOT in scope |
| `story:246` | `ISBN <the edition.s>` | not in scope |
| `story:245` | the CIP record | **the whole scope** |
| `story:243` | the annotation | not a bibliographic record |
| `story:249` | «Created by the publisher PUBLISHER, editor in chief: the editor-in-chief.» | publisher's statement, not a record |
| `story:244` | `All rights reserved / © Firstname Surname / © the editor-in-chief / © 2026 PUBLISHER™` | copyright block |

`story:244` matters to one rule specifically: it carries the publisher's
name in the ALL-CAPS trademark form with `™`. That is the SPECIMEN of how
the house writes its own name — which is why a rule proposing
`PUBLISHER` → `Publisher` inside the record cannot be
`high` confidence. The «specimen ≠ usage» gate is the same one that Phase 14
found missing in two detectors out of five.

Page 196 (`story:247`, `story:248`) carries the credits and the colophon.
Neither is a bibliographic description, and neither is in scope.

---

## 5. The typographic rule and the record do not collide today

`typography_audit locale=en-US ruleIds=["en-dash-parenthetical-us"]`:

| document | `totalMatches` | where |
|---|---|---|
| «…EN-print.indd» | **1** | `story:23`, page 9 — the heading «BIRTH — MEETING YOUR BABY» |
| «…EN.indd» | **1** | `story:10`, page 9 — the same heading |

The imprint does NOT appear. The bibliographic exception committed in
`d869c17` holds: the Chicago dash rule leaves the record's ` — ` alone.

This has a direct consequence for the design. Once the record is converted
to Chicago, its ` . — ` separators disappear and the exception stops having
material HERE — but it must stay, because it protects the Ukrainian edition
and any unconverted English one. The two must not be made to depend on each
other.

---

## 6. What the type system forbids

`Standard` is `"7.1" | "8302"` (`src/bibliography/rules-dstu.ts`) and is
passed straight into `DSTU_RULES.check(parsed, standard)`
(`src/tools/bibliography.ts:65`). Widening that union to include
`"chicago"` would hand every ДСТУ rule a value it has no branch for, and
the failure would be silent — a rule would simply take its `else`.

The dispatch must therefore SELECT the family, not filter it: when the
standard is Chicago, `DSTU_RULES` must not be consulted at all, and
`Standard` must not gain a third member.

---

## 8. Live run of the finished family — and the defect it found

Run on 2026-08-27 after the family was built, on both English editions,
through `node` + `dist/` + the same bridge the MCP tool uses. The MCP server
starts from the main checkout, which does not carry this branch, so the tool
itself could not be used — the same route `docs/measured-facts-bibliography.md`
took, for the same reason. Read-only: `containers_read` only.

### 8.1 The first run failed, and 1700 green tests had not shown it

| | ДСТУ 7.1 | Chicago, FIRST run |
|---|---|---|
| records | 0 | **6** |
| unparsed | 0 | **5** |

Five of the six entries were prose. Every one of them had the same shape — a
capitalised word followed by a lone `I` or an all-caps word:

```
When I found out …      Today I’m a mom …      Here I want to speak …
Professionally, I …     Do NOT rely on …
```

The opener required only `[A-Z][a-z]+` + `[A-Z]`, and «When I», «Today I»,
«Do NOT» all satisfy it. The discriminator then passed them on its
quoted-article-title alternative, because running prose is full of quoted
words.

**This is the ДСТУ trap, reached by a different road** — the same trap the unit
test was written to prevent. That test proved nothing: its prose sample had
been chosen with lowercase second words, which is not what English prose looks
like.

The damage was contained by the parser, which rejected all five as
`no prescribed punctuation mark found`, so no false FINDING was produced. But
`records: 6` is a false number, and it is the number `bibliography_apply` gates
its write on.

Fixed in two layers: the second token must now look like a given name (`Ann` or
`J.`), and the quoted-phrase alternative is gone from the discriminator — a
Chicago article entry carries a year as well, so nothing is lost.

### 8.2 After the fix

| | 184-page edition | 196-page print edition |
|---|---|---|
| ДСТУ 7.1 records | 0 | 0 |
| Chicago records | **1** | **1** |
| Chicago unparsed | **0** | **0** |
| Chicago findings | **7** | **7** |
| record location | `story:154`, p. 4 | `story:245`, p. 4 |
| skipped `heading` | 2330 | 2425 |
| skipped `no-discriminator` | 10 | 10 |
| skipped `cyrillic` | 2 | 2 |

All seven findings sit on the CIP record and nowhere else — nothing on the
annotation, the copyright block, the publisher's statement or the colophon:

| rule | confidence |
|---|---|
| `chicago-heading-comma` | high |
| `chicago-zone-separator` (×2) | high |
| `chicago-colon-spacing` | high |
| `chicago-responsibility-repeat` | high |
| `chicago-extent` | needs-review |
| `chicago-publisher-caps` | needs-review |

Two paragraphs in each English edition are skipped as `cyrillic`. The gate
fires on real material, not only on a fixture — though on Ukrainian LEFTOVERS
inside an English book, which is not the same as a run over the Ukrainian
edition.

### 8.3 Two tests were already failing on `main` — and my first diagnosis was wrong

`tests/integration/styles-audit.test.ts` fails two assertions —
`expected 10597 to be 10310` and `expected 12308 to be 12021`, a constant +287
in both.

**Not a regression from this branch.** Verified by execution: a scratch
worktree at `0b846cf`, the branch point, fails the same two assertions with the
same numbers.

**The cause, established later and NOT what this section first said.** It is a
CODE change, not the document. Commit `65c6d90` (2026-08-27 00:26, already an
ancestor of `0b846cf`) appended one sentence to the shared
`UNUSED_STYLE_CAVEAT_TEXT` in `src/tools/styles.ts` — «AND ON DELETING A
BRANCH: …». Measured: 286 UTF-8 bytes, 287 with its leading space. The delta is
constant across both responses because the caveat ships ONCE per response, in
`caveats.tablesAndFootnotes`, not per finding — which is exactly the
"structural addition" signature the test file's own comment history describes.

**Two things this section originally claimed, both false:**

- *"the numbers are pinned against the user's live document, which has
  changed."* Impossible by construction: `beforeAll` calls
  `makeLayoutFixtureDoc()`, so these tests measure a fixture built from
  scratch. The open editions cannot affect them.
- *"it is the shelf-life problem Phase 12 already paid for."* Wrong diagnosis
  from a plausible pattern. Phase 12's lesson is real; it simply was not this.

**How I got it wrong, which is the part worth keeping.** I asserted the cause
without running `git log -- src/styles/ src/tools/styles.ts`. Two commits had
touched those paths. Worse, I leaned on the test file's own 2026-08-25 comment,
which records that same `git diff` coming back empty — and treated a RECORDED
CHECK as a STANDING FACT. It was true the day it was written and false two days
later. A dated measurement in a comment expires exactly like a dated
measurement anywhere else.

Worth naming separately: `npm test` runs `--project unit --project web`;
integration is a separate command. That is why the drift sat unnoticed — and
why "the gate is green" needs to say WHICH gate.

Whole suite on this branch: **3324 passed, 2 failed (227 files)**, the two being
the above. Their baselines were corrected in a separate session.

### 8.4 The Ukrainian edition — Chicago is inert, and that IS measured

Run on 2026-08-27, after the user opened the Ukrainian edition (196 pages, 575
containers). Read-only, and the document was `saved: true, modified: false`
before and after.

| | ДСТУ 7.1 | Chicago |
|---|---|---|
| records | 91 | **0** |
| unparsed | 91 | 0 |
| findings | 0 | **0** |
| skipped `cyrillic` | — | **2079** |
| skipped `heading` | 1862 | 360 |
| skipped `no-discriminator` | 43 | 0 |

**Chicago is inert on a Ukrainian book, and that is now measured rather than
argued.** Not one entry opens, not one finding is produced, and 2079 paragraphs
carry the honest reason — `cyrillic`, not `heading`. What §8.5 then shows is
that the inertness is NOT the Cyrillic gate's doing: the Latin-only opener
achieves it alone. That distinction is the
one the gate was moved a layer down to make (see the commit that moved it): a
paragraph reported as a "heading" would have read as "this looked like a
section title" instead of "this is not our material".

The ДСТУ column is a side observation, not a defect of this work, and it is
recorded because it is the same mechanism seen from the other side: on this
book the ДСТУ segmenter opens 91 records and the parser rejects ALL 91 as
unparseable. They are numbered checklist items — «1. …», «2. …» — not
bibliography. Findings: zero.

So both segmenters lean on the parser as their last line of defence, and on
each book the other one's segmenter over-opens: ДСТУ 91 false records here,
Chicago 5 there before it was tightened. The containment worked both times,
but `records` is reported next to `unparsed` precisely so that a reader can
see the difference — a bare `records: 91` would be a false number.

### 8.5 The Cyrillic gate prevents NOTHING on any of these three books

The gate was disabled (`if (false && hasCyrillic(para))`), rebuilt and re-run
against all three documents. The result is the same everywhere:

| document | with the gate | without it |
|---|---|---|
| Ukrainian, 196 p. | `records 0, findings 0`, skipped `cyrillic: 2079` | `records 0, findings 0`, skipped `heading: 2439` |
| English print, 196 p. | `records 1, findings 7`, skipped `cyrillic: 2` | `records 1, findings 7`, skipped `heading: 2427` |

**Nothing changes except the reported reason.** The real gate is the Latin-only
opener; `hasCyrillic` is a second lock on a door the first one already holds.

This is written down rather than quietly left out, because it is the kind of
code this project deletes: Phase 9 removed three abstractions that had zero
consumers, and a defensive branch that never fires on any real material looks
exactly like one.

It is kept, and the argument for keeping it is NOT "it might help" — it is a
named case the tool is meant to serve and these books do not contain: **a
Ukrainian academic work with a Latin-script source list.** There Chicago is the
right standard, the document is full of Cyrillic, and the gate stops a
Latin-opened entry from absorbing the Cyrillic paragraph next to it (the case
`bibliography-segment-chicago.test.ts` covers as «кириличне продовження не
приростає до латинського відкривача»).

Its protective value on real material is therefore **unmeasured**, not proven.
The measured value is narrower and still worth something: the skip reason tells
the truth — 2079 paragraphs reported as `cyrillic` rather than as `heading`.

## 9. What is STILL not measured

- No Chicago-conformant bibliography has been run through the family, because
  no such material exists in these books or in the repository.
- The Cyrillic gate's PROTECTIVE value: it changes no outcome on any of the
  three documents (§8.5). The case it is kept for — a Ukrainian work with a
  Latin-script source list — has never been run.
