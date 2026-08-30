# Measured facts — Phase 12 (`«пів»`, 2019 orthography)

**Date:** 2026-08-14. **Document:** `Book 260811-1645.indd`, 196 pages,
InDesign 21.5.1.73. **Read-only:** only `indesign_status` and `text_find`;
the book was not copied, `modified: false` before and after.

The measurement was taken **BEFORE writing any code** — with the existing
`text_find`, to find out whether the phase has material to work with, and
so that spec §9's numbers would come from a measurement, not from
expectations.

---

## Headline: the phase has material, unlike Phase 11

**There is a genuine finding in the book** — `півгодини` instead of `пів
години`, **p. 125** (`story:168`, offset 2026):

> «…а зачіска розпалась вже за **півгодини**, сукня не налізла…»

`години` is in the source orthography's own list of separate-form examples
(`пів години`), so this is a `wrong` verdict under spec §4.2, not an
inventory row. The user confirmed the norm separately: "«пів години» is
definitely always written as two words."

This is what distinguishes Phase 12 from Phase 11, where all three rules
gave zero on this book.

## Full count: 20 matches of the substring «пів»

`text_find` searches for a substring, so everything ends up in the sample.
The classification below was done by hand from the context of each match.

| Group | How many | What filters it out |
|---|---|---|
| Inside other words | **12** | the left boundary `(?<![\p{L}\p{N}])` |
| Start of word, but not "пів + noun" | **1** | the §6.2 non-numeral list |
| Genuine "пів + noun" | **7** | — |
| **Total** | **20** | |

### 12 matches inside other words

`співіснувати` (p. 14, 85), `купівлі` (p. 54 ×2), `принципів` (p. 56),
`самоспівчуття` (p. 84 ×2), `співпраця` (p. 114), `закрепів` (p. 178),
`співати` (p. 135), `етапів` (p. 4), `напівфабрикатів` (p. 172).

**60% of all matches.** The left boundary is not a theoretical trap
inherited from Phase 11, but the main filter of this family on real text.
Mutant 1 in spec §8 is essential.

`напівфабрикатів` is filtered out by that same left boundary (`на` sits
before `пів`), not by a separate rule — the spec explicitly puts `напів-`
outside the phase's scope (§2).

### 1 match — `півтори` (p. 22, `story:2`)

> «…проспала години **півтори** — і прокинулась…»

**This is a gap in the spec, found by measurement.** `півтори` is a
standalone numeral ("one and a half"), not "пів" + a noun. The left
boundary does NOT filter it out (the word starts with "пів"), and the §6.2
non-numeral list does not include it: it lists `півень`, `півонія`,
`півник`, `півча`. Without a fix, the family would have produced the stem
`тори`.

**Fix to §6.2:** add `півтори` and `півтора` (both genders) to the
non-numeral list. Also check `півтораста` while at it.

### 7 genuine "пів + noun" cases

| Spelling | Stem | Pages | Verdict |
|---|---|---|---|
| `пів року` | `року` | 11, 140, 181 | inventory |
| `пів дня` | `дня` | 190, 193 | inventory |
| `пів квартири` | `квартири` | 116 | inventory |
| `півгодини` | `години` | 125 | **`wrong`** |

## Pre-reform spellings: zero, and the zero is measured

| Pattern | Matches |
|---|---|
| `пів-` (hyphen) | **0** |
| `пів'` (apostrophe U+0027) | **0** |
| `пів’` (apostrophe U+2019) | **0** |
| `Пів` (capitalized) | **0** |

The book is modern; the apostrophe and hyphen forms are not in it at all.
This is consistent with Phase 11's measurement (`прое(?=к)` — 0, `проєк` —
3: the book is already post-reform).

**Consequence for acceptance:** the book does NOT exercise the `apostrophe`
and `hyphen` branches — exactly like the language gate in Phase 11. Proof
for them has to come from the fixture and the mutants (4 and 8 in spec §8),
not from a run on the book. Stated out loud so "0 findings" is not retold
as "verified on the book."

## Expected numbers for the acceptance criteria

Derived by hand from the measurement above; the tool must reproduce them
itself:

- `wrong` = **1** (`години`, p. 125)
- `mixed` = **0** — and this is not "the book is consistent," see below
- stems in inventory = **3** (`року`, `дня`, `квартири`)
- `excludedNotNumeral` ≥ **1** (`півтори`)
- matches filtered by the left boundary = **12**

## `mixed` = 0 on a book that is NOT self-consistent — §10's boundary in action

The book writes "пів" separately **six** times (`пів року` ×3, `пів дня`
×2, `пів квартири`) and joined **once** (`півгодини`). So the layout really
is inconsistent — and `mixed` **does not see it**, because the stems are
different (`року`, `дня`, `квартири` versus `години`), and grouping is done
by exact stem string.

This is not an implementation flaw, but exactly the boundary spec §10 names
in advance: **`mixed` systematically undercounts, because inflection
breaks the grouping.** It is no longer hypothetical — it is measured on the
very first book, and that is exactly why the verdict from the source list
(§4.2) carries all the weight here, and `mixed` carries none.

**A candidate DELIBERATELY not taken:** a document-wide counter of "how
many joined vs. how many separate across the whole book" would have caught
this inconsistency in one number (6 vs. 1). Not added, because §3.3
forbids new concepts without need, and the list-based verdict already
catches the same spot here. If another book shows the list to be
insufficient, this is the first candidate.

## Limits of this measurement itself

- `text_find` searches for a **substring**, not a regex; the classification
  of the 20 matches was done by hand from context. The tool will classify
  by pattern, so a matching count is a real criterion, not a tautology;
- the measurement is NOT language-gated (`text_find` knows nothing about
  language), while the family is gated. The book is practically
  monolingual (Phase 11: `ukrainianRuns` = 534, `mixedCount` = 0), so no
  mismatch is expected — but if the tool gives fewer than 7, the first
  suspect should be the ~520 characters on p. 31 (`story:335`) **with no
  assigned language**, found by Phase 11 and still not fixed;
- `text_find` does not filter out master pages, the family does. None of
  the 20 matches sits on a master (all have a page number), so no mismatch
  is expected here either.

---

## Mutants

Proof by EXECUTION, per the Phase 5 rule: each mutant was inserted into
`src/typography/piv2019.ts` by hand, `npx vitest run
tests/unit/typography-piv2019.test.ts` was run, the names of the failing
tests were recorded from vitest's real output, and only then was the file
reverted (`git checkout src/typography/piv2019.ts`). Not one result below
is retold from reasoning — where a previous run from another phase had
already delivered a ready verdict (rulings R7–R10), it was re-checked by
execution, not taken on faith.

Baseline: before the first mutant and after reverting the last —
`npx vitest run tests/unit/typography-piv2019.test.ts` gives **55 passed
(55)**.

### Results table

| # | Mutant | Change | Failed | Tests that failed |
|---|---|---|---|---|
| 1 | left boundary removed | drop `(?<![\p{L}\p{N}])` | **4** | ліва межа … › не ловить усередині «співати»; «купівлі»; «самоспівчуття»; «напівфабрикатів» |
| 2 | class 2 removed | drop `півтори`/`півтора`/`півтораста` from `NOT_NUMERAL_PREFIXES` | **2** | не-числівники виключаються … › «півтори» не дає основи; півтори в реченні книжки |
| 3 | language gate removed | `fullyInLanguage(...)` → `true` | **1** | collectPivStems › чужомовний діапазон відкидається і ЛІЧИТЬСЯ |
| 4 | only one apostrophe | `['’]` → `[']` | **2** | matchPivForms … › типографський апостроф U+2019 — теж apostrophe; collectPivStems › основа з ТРЬОМА написаннями теж mixed, не лише з двома |
| 5 | `mixed` as "exactly two" | `forms.length > 1` → `forms.length === 2` | **1** | collectPivStems › основа з ТРЬОМА написаннями теж mixed, не лише з двома |
| 6 | master filter removed | drop `if (c.isMaster) continue` | **1** | collectPivStems › майстер-сторінки поза аудитом |
| 7a | §4.3 set removed | `AMBIGUOUS_STEMS` → `new Set()` | **3** | три неоднозначні основи … › «аркуша» разом — не хибно; «острова» разом — не хибно; «літра» разом — не хибно |
| 7b | set applied one-sided | move the `AMBIGUOUS_STEMS` check to AFTER `SEPARATE_SET` | **3** | the same three "…разом — не хибно" as in 7a (see below) |
| 8 | only a plain space | `[  ]` → `[ ]` | **1** | matchPivForms … › нерозривний пробіл — теж separate |
| 9 | Cyrillic lookahead removed | drop `(?=\p{Script=Cyrillic})` | **1** | після роздільника мусить бути КИРИЛИЧНА літера › не ловить «пів on-line» |
| 10a | lists swapped (literally — whole blocks) | swap the ENTIRE blocks of the `SEPARATE_SET` branch and the `TOGETHER_NOMINATIVE` branch | **0 — SURVIVED** | — |
| 10b | lists swapped (inner conditions) | swap `kinds.has("solid")` / `kinds.has("separate")` between the branches, leaving the blocks in place | **4** | classifyStem … › основа з роздільного переліку, написана РАЗОМ — хибно; основа з разомного переліку, написана ОКРЕМО — хибно; ті самі основи, написані ЗА переліком — не хибні; collectPivStems › wrongCount рахує лише вирок |
| 12 | page sort AFTER truncation (not in the spec's list — ruling R10) | in `collectPivStems`: `[...cell.pages].slice(0, MAX_PAGES_LISTED).sort(...)` instead of `[...cell.pages].sort(...).slice(0, MAX_PAGES_LISTED)` | **1** | collectPivStems › сторінок понад ліміт — обрізає ПІСЛЯ сортування, не до |

Eleven mutants from the spec plus a twelfth per ruling R10 — thirteen runs
in total (mutant 10 counted as two readings, as ruling R8 requires).

### Ruling R7 — checked by execution: both of the plan's predictions were wrong

**Mutant 7b.** The plan expected that moving the `AMBIGUOUS_STEMS` check to
AFTER `SEPARATE_SET` would give the stem `літра` a `wrong` verdict on «пів
літра». On execution this did NOT happen: `літра` is still in
`SEPARATE_SET`, and with `kind = "separate"` the `SEPARATE_SET` branch
returns `inventory` regardless of whether `AMBIGUOUS_STEMS` is checked
before or after — both orders give the same verdict for the separate form.
The mutant does genuinely die, but on the SOLID cases (`kind = "solid"`):
«острова», «аркуша», «літра» — "together — not wrong" — exactly the same
three tests that failed in 7a. The cause is the same in both mutants:
without `AMBIGUOUS_STEMS` doing its job (either the set removed, or its
priority removed in a place where there is in fact no difference, because
the `SEPARATE_SET` branch contradicts it under `solid`), the stem falls
into the `SEPARATE_SET` branch and, under `kind = "solid"`, gives `wrong`
instead of `inventory`.

**Mutant 9.** The plan expected that removing the Cyrillic lookahead would
give «пів 2020» the stem `2020`. On execution the test `не ловить «пів
2020 року»` STILL PASSED (did not fail) — `STEM_TAIL` (`/^[\p{L}'’]+/u`)
requires letters, not digits, so digits never produce a stem match, with
or without the lookahead. The mutant does genuinely die — but on the LATIN
case: `не ловить «пів on-line»` fails, because without the Cyrillic
lookahead the Latin `on` passes as an ordinary stem (`\p{L}` is not
restricted by script).

### Ruling R8 — both readings of mutant 10 were run, both recorded

The plan's wording ("swap the `SEPARATE_SET` and `TOGETHER_NOMINATIVE`
branches") has two readings, and BOTH were carried out:

- **10a, the literal reading** — the TWO WHOLE BLOCKS were swapped (the
  `TOGETHER_NOMINATIVE` check now comes first, then `SEPARATE_SET`,
  instead of the other way round). Run result: **55 passed (55)** — the
  mutant SURVIVED, nothing failed.

  **The reason, checked by CALCULATION in node, not by retelling the
  ruling.** The two sets the BRANCHES themselves check against (not
  `AMBIGUOUS_STEMS`):

  ```
  SEPARATE_SET        = {аркуша, відра, години, літра, міста, огірка,
                          острова, яблука, ящика, ями, європи, києва, україни}
  TOGETHER_NOMINATIVE = {аркуш, день, захист, коло, куля, літра,
                          місяць, оберт, овал, острів}
  ```

  The intersection of these two sets, computed directly, is `{літра}` —
  EXACTLY ONE stem, not three: «аркуш» ≠ «аркуша», «острів» ≠ «острова»
  (nominative and genitive forms are different words in the list), so
  those two are not in the branch intersection at all. «літра», however,
  is recorded identically in the source for both nominative and genitive —
  so it is the only one able to satisfy the condition of BOTH branches at
  once.

  This differs from `AMBIGUOUS_STEMS` (a set of THREE: аркуша, острова,
  літра) — that set is computed as the intersection of the GENITIVE forms
  of both lists (`SEPARATE_STEMS` and `w.genitive` for each
  `TOGETHER_WORDS` entry), i.e. in ONE case. The branches, by contrast,
  compare `SEPARATE_SET` (genitive) against `TOGETHER_NOMINATIVE`
  (nominative) — different cases, so their intersection is smaller and
  does not match `AMBIGUOUS_STEMS` as a set.

  For the question "does block order matter," what matters is precisely
  the BRANCH intersection (`{літра}`), not `AMBIGUOUS_STEMS` as a whole:
  `AMBIGUOUS_STEMS` is checked BEFORE both branches, and since «літра»
  itself is in `TOGETHER_WORDS` (both its nominative and genitive forms
  are «літра»), it lands in `AMBIGUOUS_STEMS` and gets intercepted before
  reaching either branch. After that interception, `SEPARATE_SET` and
  `TOGETHER_NOMINATIVE` no longer share a single stem — the domains are
  disjoint, and the order in which they are checked has no effect on the
  result. This is not a hole in the tests, but a property of the code:
  `if` branches with disjoint conditions are commutative by construction.

  **What would have to happen for block order to start mattering.** If a
  word were added to one of the lists such that some stem ended up in BOTH
  `SEPARATE_SET` and `TOGETHER_NOMINATIVE` at once (as «літра» is now), BUT
  did NOT land in `AMBIGUOUS_STEMS` — which happens if the overlap occurs
  between the GENITIVE form of one list and the NOMINATIVE form of the
  other, while `AMBIGUOUS_STEMS` only compares the genitive forms of both.
  Example scenario: a new word in `TOGETHER_WORDS` whose nominative form
  matches letters with some stem already in `SEPARATE_STEMS`, whose own
  genitive form is NOT in `SEPARATE_STEMS`. Then `AMBIGUOUS_STEMS` (built
  on the genitive) would not intercept that pair, while the branches (one
  genitive, one nominative) WOULD overlap, and the
  `SEPARATE_SET`/`TOGETHER_NOMINATIVE` order would become significant for
  that stem.
- **10b, the "inner conditions" reading** — the blocks stayed in place,
  and the conditions inside them (`kinds.has("solid")` in the
  `SEPARATE_SET` branch and `kinds.has("separate")` in the
  `TOGETHER_NOMINATIVE` branch) were swapped. Run result: **4 failed, 51
  passed**. This reading genuinely breaks the logic (a stem from the
  separate-form list, written JOINED, is no longer wrong — and vice
  versa), and that is exactly why the tests react to it.

**The conclusion, stated plainly:** the literal reading of mutant 10
SURVIVES — and this is a fact about the code's design (disjoint branches
are commutative after `AMBIGUOUS_STEMS` interception), not a gap in test
coverage. A synthetic test that "closes" exactly this reading would have to
be written against invented data that is in neither of the source's two
closed lists (§36, п. 6) — i.e. the test would be checking not the tool's
behavior on the real language, but its own invention. Spec step 2 ("a
surviving mutant is a finding, add a test") is deliberately NOT carried out
here in the literal sense: ruling R8 decided in advance that the correct
action for 10a is to record the cause, not to force a test. Mutant 10b,
which genuinely tests sensitivity to the order of CONDITIONS (not the
order of BLOCKS), already fails on the existing tests — it needs no
additional coverage.

---

## Task 10: a run on the book with the branch's own build

**Date:** 2026-08-15. The same document, `Book 260811-1645.indd`,
196 pages, InDesign 21.5.1.73 — open, `modified: false` at the start.

**Script:** `scripts/measure-piv12.mjs`. Mirrors what `typography_audit`
does (`src/tools/typography.ts:186-244`): `containers_read` →
`readLanguageRuns()`/`language_runs_read` → `assertLanguageCoverage` (the
seam between the two bridge calls) → filter `!c.isMaster` →
`collectPivStems(audited, auditedLangs, UK_LANGUAGE)`. Imported from THIS
branch's `dist/` (`dist/bridge/runner.js`, `dist/spelling/langruns.js`,
`dist/typography/langgate.js`, `dist/typography/piv2019.js`), NOT through
`mcp__indesign__*` — that one looks at the main checkout. No `apply`, no
`save`, no fixture; only `status` (before and after) and the bridge's
read-only handlers. **ONE field differs:** the script builds the response
object without `caveat` (`PIV2019_CAVEAT`), whereas the real
`typography_audit` always adds it to `piv2019`. This was deliberately not
addressed earlier and it affects the response size below — see the note
next to "812 bytes."

### `modified` before and after

- Before: `false`
- After: `false`

Unchanged. Run twice in a row (a stability check) — both times the same
result, `modified: false` at both points of both runs.

### Raw numbers from the run

```json
{
  "docName": "Book 260811-1645.indd",
  "piv2019": {
    "ukrainianRuns": 532,
    "stems": [
      { "stem": "години", "verdict": "inventory", "reason": "matches-list",
        "forms": [{ "kind": "separate", "count": 1, "pages": ["125"] }] },
      { "stem": "дня", "verdict": "inventory", "reason": "not-in-lists",
        "forms": [{ "kind": "separate", "count": 2, "pages": ["190", "193"] }] },
      { "stem": "квартири", "verdict": "inventory", "reason": "not-in-lists",
        "forms": [{ "kind": "separate", "count": 1, "pages": ["116"] }] },
      { "stem": "року", "verdict": "inventory", "reason": "not-in-lists",
        "forms": [{ "kind": "separate", "count": 3, "pages": ["11", "140", "181"] }] }
    ],
    "stemsTruncated": 0,
    "wrongCount": 0,
    "mixedCount": 0,
    "skippedByLanguage": 0,
    "excludedNotNumeral": 1
  }
}
```

- containers total: **574**; non-master (`audited`): **534**.
- run time (from `containers_read` to a finished `collectPivStems`):
  **≈6.3–7.0 s** (two runs: 6324 ms and 6973 ms — system-level jitter, not
  the tool's).
- response size (`docName` + `piv2019` only, `JSON.stringify` in UTF-8
  bytes): **812 bytes**. This number is MEASURED on a real run and stays
  fixed forever — but it is the size of only PART of the `piv2019` block:
  the script (`scripts/measure-piv12.mjs`) used for this run built the
  response object WITHOUT the `caveat` field, whereas the real
  `typography_audit` (`src/tools/typography.ts`) always adds
  `caveat: PIV2019_CAVEAT` to `piv2019`.

  **`caveat` is a large and MUTABLE string**, frequently refined (it has
  already gone through this very wave of edits, FIX 7). So "the real size
  of the piv2019 block" is not a constant but a **snapshot of state at a
  given moment**, and it has to be recomputed every time the text of
  `PIV2019_CAVEAT` changes. The number below is valid for the
  `PIV2019_CAVEAT` text as fixed in commit `9b8a4ef` (the last edit to the
  string itself — FIX 7 of the 2026-08-15 wave) and untouched since:

  - `JSON.stringify(PIV2019_CAVEAT)` — **2608 bytes** (computed, not
    re-measured by another run on the book).
  - So the snapshot of the full `piv2019` block at that same moment:
    **812 + 2608 = 3420 bytes (≈3.3 KB)**.

  **If these numbers have diverged from what the code gives now** (for
  example, `PIV2019_CAVEAT` was edited again) — recompute them yourself,
  do not trust the stale record here:

  ```
  npm run build && node -e 'const {PIV2019_CAVEAT}=require("./dist/typography/piv2019.js");const b=Buffer.byteLength(JSON.stringify(PIV2019_CAVEAT),"utf8");console.log("caveat:",b,"| full block:",812+b)'
  ```
- `MAX_PIV_STEMS = 60`; stems in the full inventory before truncation —
  **4**. **The ceiling is NOT reached** (4 of 60) — it is neither confirmed
  nor validated by this run, it simply does not get in the way. The claim
  "the ceiling was verified on the book" would be false.

### Cross-check against expectations (Task 10 section of the plan) — and a MISMATCH, found and investigated

| Number | Expected | Measured now | Match? |
|---|---|---|---|
| `wrongCount` | 1 (`півгодини`, p. 125) | **0** | **NO — see below** |
| stems in inventory | 3 (`року`, `дня`, `квартири`) | **4** (`години` added) | **NO — same cause** |
| `mixedCount` | 0 | 0 | yes |
| `excludedNotNumeral` | ≥1 (`півтори`) | 1 | yes |

**The cause of the mismatch was established by reading the raw text, not by
guessing.** A direct `containers_read` call and a search for the substring
`"годин"` in container `story:168` (the very one the p. 125 example was
taken from in the pre-code measurement) gave:

> `"...розпалась вже за пів години, сукня не налі..."`

The characters between «пів» and «години» are an ordinary space (U+0020),
not an empty string. **So the LIVE document now has `пів години` written
SEPARATELY**, not `півгодини` JOINED, as recorded in the pre-code
measurement (the section above, dated 2026-08-14 — one day before this
run). The word «години» is in the source's separate-form list (§4.2), so
`пів години` written separately is exactly the record the list calls for:
verdict `inventory` / `matches-list`, not `wrong`.

A full re-pass over all 20 substring matches of «пів» in the document (with
the same direct `containers_read` call, without the language gate and
without the stem filter — as in the pre-code measurement) gave **exactly
20 matches**, distributed across the same containers and pages as in the
pre-code measurement. This rules out the "the tool is reading the wrong
text" explanation: the mismatch is not in the bridge, it is in this one
word specifically.

**Conclusion:** the book is in active production (Google Drive, still
being edited), and the most plausible explanation is that the
`півгодини → пів години` fix was already applied to the document between
the pre-code measurement (August 14) and this run (August 15). This is
consistent with the note in the pre-code measurement: "The user confirmed
the norm separately: '«пів години» is definitely always written as two
words'" — a norm confirmation recorded at exactly the moment the book still
had the wrong spelling could well have come together with an actual edit.

This is **not a code defect**. Both classification branches are already
proven by unit tests and mutants:
`cls("години", "solid") → wrong` (`tests/unit/typography-piv2019.test.ts:167`)
and `cls("години", "separate") → inventory` (same file, :184) — both
checked by execution in the mutants section above (mutant 10b breaks
exactly this pair of branches). The tool answered CORRECTLY on this run,
for the text that is actually in the document right now — the numbers
diverged from the expectation because the DOCUMENT ITSELF changed, not
because the family's behavior changed. The code was NOT adjusted to fit —
the expectations in the plan's table were likewise NOT rewritten; the
mismatch is documented here alongside its cause.

**Consequence for acceptance:** the criterion "`wrongCount` = 1" was
derived from the book's state at the moment it was written down by hand;
it stopped holding not because it turned out to be wrong, but because the
book no longer contains the spelling that was supposed to confirm it. The
`wrong` branch of `piv2019` remains proven by the fixture and the mutants
(section above), just not by this particular run on this particular book
at this particular moment.

### What is confirmed without reservation

- `excludedNotNumeral = 1` (`півтори`, p. 22, `story:2`) — exactly as
  expected; the §6.2 gap found by the pre-code measurement remains closed.
- `mixedCount = 0` — expected. The sum of `forms` in this very run:
  `години` 1 + `дня` 2 + `квартири` 1 + `року` 3 = **7** separate
  spellings, **0** joined. Across these four stems the book **on THIS
  run is in fact CONSISTENT** — exactly the mismatch that used to make it
  inconsistent (one joined `півгодини` against the rest being separate)
  was fixed between the two measurements (see the "Task 10" section
  above). So here `mixedCount = 0` does NOT demonstrate §10's boundary —
  there is nothing to demonstrate it with: among these stems there is no
  longer any "joined/separate" mismatch. §10's boundary was demonstrated
  precisely by the **pre-code measurement**: at that point the book was
  inconsistent (6 separate spellings — `року`, `дня`, `квартири` — against
  1 joined one — `години`, all DIFFERENT stems), and `mixed`, which groups
  by exact string rather than document-wide, would by construction have
  given zero on that state too. The demonstration belongs to that earlier
  state, not to this run — and that is exactly why the caveat remains true
  IN GENERAL: `mixedCount = 0` cannot be read as "the edition is
  consistent," even when — as now, by coincidence — it genuinely is.
- `skippedByLanguage = 0` — none of the 20 substring matches of «пів»
  falls in the ~520-character no-language zone on p. 31 (`story:335`);
  the language gate did not touch a single real match here, as the
  pre-code measurement predicted.
- `ukrainianRuns = 532` — close to Phase 11's value (534), a small
  discrepancy consistent with the document being live and continuing to
  change between phases; not investigated further, since it does not
  affect any counter in this task (there is no «пів» match in the zone of
  difference).

### Limits of this run

- Pre-reform spellings (`apostrophe`, `hyphen`) are still not exercised by
  this book — zero expected and measured, proof remains the fixture and
  mutants 4, 8, not this run.
- The `MAX_PIV_STEMS = 60` ceiling is not reached (4 stems) — not
  confirmed, merely not in the way.

### Ruling R10 — a twelfth mutant, not listed in the spec's table

Moving the page sort to AFTER truncation (instead of BEFORE) in
`collectPivStems` — a mutant added beyond the spec's eleven, on the
ruling's direct instruction. At Task 5 a regression test already existed
for this exact mutant ("сторінок понад ліміт — обрізає ПІСЛЯ сортування,
не до"), written precisely because this mutant used to survive. Re-checked
by execution: the mutant FAILS this one test (**1 failed, 54 passed**) —
the regression is now closed.

### Summary: what survived

Of thirteen runs (10a and 10b counted separately), EXACTLY ONE survived —
10a, the literal reading "swap the whole blocks." Per ruling R8 this is a
documented property of the design (disjoint branches after
`AMBIGUOUS_STEMS` interception), not a coverage gap: there is no input
within the source's two closed lists on which the order of these two
blocks could give a different verdict. The remaining twelve runs (1, 2, 3,
4, 5, 6, 7a, 7b, 8, 9, 10b, 12) all failed, with test names recorded above
from vitest's real output.

### A clean tree after all mutants

`git status --short` after reverting each mutant is empty (checked after
every individual mutant, not just at the end). The final run of
`npx vitest run tests/unit/typography-piv2019.test.ts` after reverting the
last (12th) mutant gave **55 passed (55)** again — the same result as
before the first mutant.
