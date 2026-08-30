# Measured Facts of Phase 9 — probe `H9`

**Facts drive the spec, not the other way around.** Everything here was
obtained by execution on live InDesign **21.5.1.73** (Phase 8 measured on
21.4.1.4 — timing numbers here are not directly comparable with Phases
6–8), on the user's open working book `Book 260811-1645.indd`
(196 pages). The run is **read-only only**: `containers_read` and
`run_script` with purely read-only ExtendScript, no `apply`, no write. The
document was not saved, not closed, not modified.

Instrument: `scripts/probe-h9.mjs`, via **this branch's**
`dist/bridge/runner.js` — the MCP tools show the main repository checkout's
code, not this worktree's (rule established by probes H3–H8).

Date: 2026-08-13.

---

## Question 1: the cost of `containers_read` — acceptable, and there's nothing to check tables/footnotes against

```
QUESTION 1 — containers_read: 4532 ms, 574 containers, 219125 characters
  by kind: {"text":574}
```

**4.5 seconds for 574 containers and 219,125 characters.** This is already
a live tool (spec §4.2 relies on exactly this), so this isn't a new cost —
it's confirmation that it's acceptable for a book this size. Acceptable: a
single pass over the book's entire text is enough for an audit.

**All 574 containers are `kind: "text"`.** Not one `"table"`, not one
`"footnote"`. This confirms a measurement made earlier while writing the
spec (§0, "this book has 0 tables and 0 footnotes") — **there is nothing to
check it against**: the path in `containers_read` that sees
`kind: "table"`/`kind: "footnote"` (spec §6) remains unverified by
execution on this book, and there is officially no boundary case here.

---

## Question 2: the cost of an ADDITIONAL pass over language ranges — acceptable

```
QUESTION 2 — language ranges: 836 ms, 2336 ranges
  languages: ["Ukrainian=2333","Vietnamese=1","[No Language]=2"]
```

**836 ms for 2336 `textStyleRanges` ranges.** The probe script walks
`stories.everyItem().getElements()` and, for every story,
`textStyleRanges.everyItem().getElements()` — the linear form that Phase 8
proved to be the only viable one (indexing the collection costs 35 times
more). The cost is acceptable: 836 ms means the interface doesn't need a
fallback switch (spec §9 already anticipated this: "if the measurement
turns out to be expensive… a decision with a number in hand") — the number
says it isn't expensive.

**Three languages in the book, and they are the same ones the earlier
reconnaissance found (spec §0), with a small shift because the book has
changed slightly since then** (`2333` versus the earlier `2424` Ukrainian
ranges on a copy from 2026-08-07 — different text revisions, not different
measurements):

- `Ukrainian` — **2333** ranges, the main body;
- `[No Language]` — **2** ranges;
- `Vietnamese` — **1** range.

**Conclusion:** the `language` family will have at most a handful of
findings on this book (not hundreds) — a sum of `2 + 1 = 3` non-standard
ranges against `2333` standard ones.

---

## Question 3: `userDictionaries` — 60 dictionaries, the Ukrainian one contains ONLY hyphenation marks

```
QUESTION 3 — userDictionaries (359 ms): {
  "count": 60,
  "ukrainian": {
    "addedWordsCount": 16,
    "addedWords": [
      "ва~~гіт~~но~~стей", "ви~~зна~~ча~~ти", "ві~~де~о~~зйом~~ки",
      "відео~~зйом~~ки", "гос~~по~~ди~~ня", "діз~~на~~ли~~ся",
      "нас~~прав~~ді", "нас~~трій", "пос~~тій~~но", "при~~вабли~~во",
      "пси~~хо~~а~~на~~лі~~тич~~ній", "під~~го~~ту~~ва~~ло", "са~~мо~~го",
      "тра~~ди~~ції", "транс~~лю~~ють", "ін~~фор~~ма~~цію"
    ]
  },
  "mergeUserDictionary": false
}
```

`app.userDictionaries.length === 60`. The Ukrainian user dictionary
contains **16** words, and all 16 have tildes (`~~`) — i.e. these are
hyphenation break-point marks, **not spelling exceptions**. A naive
"recognized word" list would not match any word in the text as it stands,
because no word in the book's own text is written with tildes. This
confirms spec §6 by execution, not by paraphrase.

**`app.dictionaryPreferences.mergeUserDictionary === false`** — also
measured directly. This is **an undocumented pair of properties**, found by
trial `try/catch` on both objects: `app.userDictionaries[i].mergeUserDictionary`
throws an exception, and only trying the neighboring object showed that the
property actually lives on `app.dictionaryPreferences`, not on the
dictionary itself. Likewise it was established that the properties
`userDictionary`/`dictionaryPath` simply don't exist in this scripting
model — both names throw an exception on the probe, and are confirmed by
no documentation.

**The path to the hunspell dictionary file itself** — since the scripting
model doesn't provide it (previous paragraph) — is derived from the
application's install location. `app.filePath` gave
`/Applications/Adobe%20InDesign%202026` → decoded to
`/Applications/Adobe InDesign 2026`; a search in that folder confirmed the
file:

```
/Applications/Adobe InDesign 2026/Resources/Dictionaries/LILO/Linguistics/
  Providers/Plugins2/AdobeHunspellPlugin.bundle/Contents/SharedSupport/
  Dictionaries/uk_UA/uk_UA.dic
```

`ls -la` for this file: **2,584,297 bytes**. The file's first line
(hunspell's counter): **111,403** stems — both numbers match the earlier
measurement made on this same machine while writing the spec (§0,
"Measurement 1"), and the note in `progress.md` ("same size 2,584,297 B") —
the dictionary in build 21.5.1.73 hasn't changed against 21.4.1.4.

**Conclusion:** the path to the dictionary is a function of the installed
copy of the application, not something to hardcode; on another machine it
will differ, and the production code (Task 5) must derive it the same way,
not hardcode it.

---

## Question 4: THE GATE — how many distinct word-types are in the book

```
QUESTION 4 — words: 31457, distinct word-types: 8081
  occur ONCE: 4787 (typo candidates)
  written to tests/fixtures/book-words.json: 8081 word-types
```

**31,457 words total, 8,081 distinct word-types, 4,787 occurring exactly
once.** This is a rough UPPER bound: the exact `word-unknown` share cannot
be measured yet, because the affix expander (Tasks 3–4) doesn't exist
yet — all distinct word-types in the book are counted, not just the ones
the dictionary doesn't recognize.

**A regex artifact, named out loud rather than glossed over.** Among the
8,081 word-types is one entry `"''"` (two apostrophes with no letter at
all) — the regex `[\p{L}'-]+`, taken verbatim from the brief, caught a
sequence of nothing but apostrophes/hyphens where the text has unescaped
typographic quotation marks. This is one entry out of 8,081 (0.01%) and
doesn't affect the conclusion, but Task 6 (`splitWords`) must account for
it — a rough upper-bound brute-force regex inevitably catches non-words,
and that's exactly why it's an upper bound, not an exact figure.

---

## Phase gate — does the `dictionary` family make sense

**8,081 word-types across a 196-page book is NOT the number that will end
up in the report.** The report (spec §5) shows only `word-unknown` —
word-types the **dictionary doesn't recognize** — not all of the book's
word-types. `uk_UA.dic` carries 111,403 stems with full suffix expansion
(34 `SFX` groups, measured in spec §0) — for standard Ukrainian prose, the
expected share of unrecognized word-types among ordinary text is usually an
order of magnitude (or more) smaller than the total count, so 8,081 is a
ceiling, not an estimate of the report's actual size.

**My reading: the gate is NOT closed.** 31,457 words and 8,081 types is a
size typical for literary prose of this length, and by itself says nothing
alarming. The real test of "is the report readable" will only come once the
affix expander exists and a real `word-unknown` count is in hand
(Tasks 3–4, 9).

**Correction (added after the 2026-08-13 review): 8,081 is NOT the basis
for Task 10's threshold.** The first draft of this section claimed that
Task 10 takes `MAX_WORD_TYPES` as ≈2× **this** measurement (8,081 →
target ≈16,000). This contradicted the paragraph above in this very
document: if the `word-unknown` share really is an order of magnitude (or
more) smaller than 8,081, then a ceiling of 16,000 would never trigger — and
a threshold that can never trigger isn't a safeguard, it's exactly the
"ceiling pulled from a guess, not from a measurement" that the Global
Constraints forbid and that Phase 5 had already violated twice. The source
of the error was Phase 9's plan, Task 10, step 5 ("take the word-type
count… multiply by 2") before the fix; I reproduced it verbatim without
checking it against my own conclusion three paragraphs above. The
controller fixed the plan (commit `e2ea3e7`): **the real basis for the
threshold is ≈2× the `word-unknown` count measured by the ACTUAL detector
run** (Tasks 4, 9), which doesn't exist yet at the time of this probe; if
no such run exists, the threshold is simply not guessed at all. The number
8,081 in this document is not, and must not be, the number the threshold is
computed from.

**What comes CLOSEST to a warning sign:** if it turned out that what's
missing is not individual words but ENTIRE CLASSES (for example, the
dictionary predates the 2019 spelling reform — spec §6 already names this,
`проєкт`/`фоє` are absent), the `word-unknown` share could be substantially
higher than "typical." This isn't visible from the number 8,081 alone —
Task 2 (an oracle via real `hunspell`) with a real share on this same book
will be needed. There's no reason to stop now: the probe's numbers confirm
that the phase moves on to the next step (the oracle), not that it needs
reconsidering.

---

## Running the finished tool — `spelling_audit` on the live book (Task 13)

**Date: 2026-08-13, the same document** `Book 260811-1645.indd`
(196 pages), the same InDesign 21.5.1.73. The run is **read-only only**:
the registered `spelling_audit` handler (`src/tools/spelling.ts`,
`dist/tools/spelling.js`) was called directly through an MCP server stub
that captures the callback in `registerTool` and invokes it with empty
arguments (`family`/`maxResponseBytes`/`languageDictionaries` not set —
the caller's default behavior). This is the REAL tool code, not a
paraphrase of its logic: no function from `src/spelling/*` is called
directly here, bypassing `spelling_audit`. No copy was made — on the
coordinator's direct instruction: `spelling_audit` doesn't write to the
document (only `containers_read`, `language_runs_read`, read-only
`run_script`), and the phase's two previous measurements already ran on
the live document with no copy.

### Raw output (verbatim, from the run script)

```
=== TIME ===
7433 ms

=== RESPONSE SIZE ===
data (JSON.stringify(data,null,2)): 49696 B
full MCP content-wrapper: 57150 B

=== docName / dictionaries ===
docName: Book 260811-1645.indd
dictionaries: [
  {
    "code": "uk_UA",
    "path": "/Applications/Adobe InDesign 2026/Resources/Dictionaries/LILO/Linguistics/Providers/Plugins2/AdobeHunspellPlugin.bundle/Contents/SharedSupport/Dictionaries/uk_UA/uk_UA.dic",
    "stems": 111376,
    "vintage": "spell-uk, © 1999–2009"
  }
]
languagesWithoutDictionary: ["Vietnamese"]

=== languages (inventory) ===
[
  { "language": "Ukrainian", "ranges": 2333, "words": 31350, "share": 0.997296007634802, "pages": [ …196 pages… ] },
  { "language": "[No Language]", "ranges": 2, "words": 85, "share": 0.0027039923651980277, "pages": ["31"] },
  { "language": "Vietnamese", "ranges": 1, "words": 0, "share": 0, "pages": ["66"] }
]

=== language findings (language-none / language-stray) ===
[
  {
    "defect": "language-stray", "containerId": "story:109", "page": "66",
    "language": "Vietnamese", "start": 3594, "end": 3595, "words": 0, "sample": "⏎"
  },
  {
    "defect": "language-none", "containerId": "story:335", "page": "31",
    "language": "[No Language]", "start": 2369, "end": 2561, "words": 30,
    "sample": "Намагайся зафіксувати свої відчуття після прийому.⏎Чи тобі с"
  },
  {
    "defect": "language-none", "containerId": "story:335", "page": "31",
    "language": "[No Language]", "start": 2562, "end": 2890, "words": 55,
    "sample": " саме для себе, а не для чоловіка, мами, свекрухи⏎чи ще кого"
  }
]

=== deviating ===
deviating: 70

=== word types ===
wordTypesTotal: 562
words.length (detailed): 162
wordsAll.length (word-unknown, full): 494
wordsNotCheckedAll.length (word-not-checked, full): 68
word-unknown (from wordsAll): 494 <= 8081 ? true

=== truncated ===
{
  "shown": 162, "total": 562,
  "wordsAllShown": 494, "wordsAllTotal": 494,
  "wordsNotCheckedAllShown": 68, "wordsNotCheckedAllTotal": 68,
  "note": "Detailed (with frequency and pages) shown for 162 of 562 word-types, rarest first. The rest — IN FULL, as bare words, in wordsAll/wordsNotCheckedAll: no word disappears, only some lack structure."
}

=== first 20 in wordsAll (rarest, count=1, alphabetical) ===
["азелаїнова","Аквамаріс","алергенними","алергенні","алергенності","аналгетики","ановуляторного","антиагрегантів","ареол","ароматерапія","аудіоповідомлення","багатогранніше","бах-бах","бебі-блюз","бебі-блюзу","бебі-корида","бензоїлпероксид","бепантеном","бета-глюкани","БЖВ"]
```

(The full `Ukrainian.pages` list — 196 values — is abbreviated here with an
ellipsis; the raw run output does not abbreviate it.)

### Acceptance criteria — verdict on each

| Criterion | Requirement | Measured | Verdict |
|---|---|---|---|
| `language-none` | finds p. 31 | 2 findings, both `page: "31"`, adjacent ranges `[2369,2561)` + `[2562,2890)` = exactly 520 characters | **met** (page and extent match, the count is 2, not 1 — see below) |
| `language-stray` | finds p. 66, `words = 0` | 1 finding, `page: "66"`, `words: 0`, `sample: "⏎"` (paragraph mark) | **met, exactly** |
| `languages` inventory | three rows: Ukrainian (nearly all words), `[No Language]`, Vietnamese (0 words) | Ukrainian 31350 words (99.73%), `[No Language]` 85 words (0.27%), Vietnamese 0 words | **met, exactly** |
| `deviating` | exactly 1, `language-none` only | **70** = 2 (`language-none`) + 68 (`word-not-checked`) | **NOT literally met — and this is a measurement, not a tool bug (explained below)** |
| `word-unknown` ≤ 8081 (H9 ceiling) | number ≤ 8081 | 494 | **met** |
| `wordsAll`/`wordsNotCheckedAll` complete | no word is lost | `wordsAllShown = wordsAllTotal = 494`; `wordsNotCheckedAllShown = wordsNotCheckedAllTotal = 68`; `words` (detail) truncated to 162 of 562 — exactly as designed (spec §5) | **met** |
| response size < 50,000 B | `MAX_RESPONSE_BYTES` ceiling | `data` (what `buildReport`/`report.ts` budgets): **49,696 B** — byte-for-byte the same number as in `report.ts` line 65's comment (an independent match from two runs on the same book); full MCP wrapper (with escaping and `content:[…]`): 57,150 B | **met** (the budget counts exactly `data`, and that's the field under the ceiling) |

### Breaking down "`deviating` = 70, not 1" — a measurement, not a bug

The "1" from the acceptance table **doesn't match the tool's own code and
types**. `src/spelling/types.ts` (the comment on `SpellingReport`) and
`src/spelling/report.ts` (the line that computes `deviating`) both say
directly: `deviating` counts **`language-none` AND `word-not-checked`
together** — `language-stray` and `word-unknown` are not counted. This
isn't a retroactive reading: the `report.ts` code line reads:

```
const deviating =
  args.language.filter((f) => f.defect !== "language-stray").length +
  args.words.filter((f) => f.defect === "word-not-checked").length;
```

On this book: `language.filter(≠stray)` gives 2 (both `language-none`),
`words.filter(word-not-checked)` gives 68 — sum 70. Two reasons, both
explained by measurement, not by a malfunction:

1. **`language-none` gives 2 findings, not 1, because InDesign itself
   splits one contiguous block into two `textStyleRange`s.** The ranges
   `[2369,2561)` and `[2562,2890)` are ADJACENT (the end of the first =
   the start of the second) — this is one and the same 520-character
   passage of prose from p. 31, cut into two style ranges by InDesign
   itself (the language tag is the same one — `[No Language]` — the split
   runs along a DIFFERENT formatting property, a cause the tool doesn't
   see and shouldn't have to). This is EXACTLY the same count that probe
   `H9` gave: "`[No Language]` — 2 ranges" (Question 2 above). The tool and
   the probe do NOT diverge here — both see 2, and that's the correct
   number for `textStyleRanges`, not "should have been 1."
2. **68 `word-not-checked` is intentional, documented behavior, not a side
   effect.** Those same 85 words on p. 31 that carry `language-none` sit
   in a range with no language — and no language means no dictionary
   code, and no dictionary code means no check. The `dictionary` family
   doesn't hide this: each of the 68 distinct word-types of that same
   passage gets `word-not-checked` and is counted in `deviating` — exactly
   the principle of spec §3 ("what wasn't measured must be visible") and
   the explicit `WordTypeFinding` comment (types.ts): "a range whose
   language the tool couldn't check at all… is counted in `deviating` —
   otherwise an unmarked language would silently pass as 'clean'."

**Conclusion:** the number "70" is the code's correct behavior per the
tool's own specification; what turned out wrong was the "exactly 1" line
in this task's acceptance criteria, which, judging by its wording, only
accounted for the `language` family and forgot that `word-not-checked` is
also counted in `deviating` (and also failed to account for one
substantive defect producing two `textStyleRange`s). This is recorded
here, not silently fixed — the code and types were left untouched.

### Cross-check against probe `H9`

| | Probe `H9` (Question 2) | This run | |
|---|---|---|---|
| Total ranges | 2336 | 2336 (2333+2+1) | matches |
| `Ukrainian` | 2333 | 2333 | matches exactly |
| `[No Language]` | 2 | 2 | matches exactly |
| `Vietnamese` | 1 | 1 | matches exactly |

**The shape of the response is identical to the probe, the word count is
expectedly different.** The probe counted word-types with a brute-force
regex and no dictionary (8,081 upper bound, out of 31,457 words total);
this run counts only words the DICTIONARY doesn't recognize (494
`word-unknown`) plus words from uncovered languages (68
`word-not-checked`) — 562 together, far below 8,081, exactly as the "Phase
gate" section above predicted ("the word-unknown share is an order of
magnitude… smaller than 8,081"). The discrepancy in Ukrainian.words (31,350
here vs. 31,457 total in H9) is an expected minor editorial change to the
book between runs (the user keeps editing it), not a discrepancy in paths.

### Detail versus completeness

`wordTypesTotal = 562`. Of these, detailed (frequency, pages, language) —
**162** rows in `words` (29% of 562); the rest are given **in full**, as
bare words with no structure, in `wordsAll` (494 of 494, `word-unknown`)
and `wordsNotCheckedAll` (68 of 68, `word-not-checked`). `truncated` is not
`null` — it's named explicitly precisely because `words` really is
truncated (162 of 562), even though no word is fully dropped from the
response.

### Literal first 20 rows of `wordsAll` (rarest, count=1, alphabetical)

`азелаїнова`, `Аквамаріс`, `алергенними`, `алергенні`, `алергенності`,
`аналгетики`, `ановуляторного`, `антиагрегантів`, `ареол`, `ароматерапія`,
`аудіоповідомлення`, `багатогранніше`, `бах-бах`, `бебі-блюз`,
`бебі-блюзу`, `бебі-корида`, `бензоїлпероксид`, `бепантеном`,
`бета-глюкани`, `БЖВ`.

**An observation, no corrections made.** The overwhelming majority read as
legitimate medical/everyday vocabulary absent from a 1999–2009 dictionary
("азелаїнова", "ановуляторного", "антиагрегантів", "бензоїлпероксид",
"бета-глюкани" — terminology; "Аквамаріс", "бепантеном" — brand names). One
row stands out as a possible, unconfirmed typo: **"бебі-корида"** — the
neighboring "бебі-блюз"/"бебі-блюзу" are obviously legitimate (a calque of
"baby blues," the postpartum condition), but "бебі-корида" ("baby
corrida"?) doesn't form any known phrase on this topic; it could also be
an author's own or colloquial expression. Not corrected — only recorded,
as the task requires.

### Literal `caveat` from the response

> Словник передує правопису 2019: правильно набране «проєкт» усе одно
> дістане word-unknown — це властивість джерела, не хиба перевірки. «Немає
> в словнику» саме по собі НЕ помилка: власні назви, неологізми й
> запозичення законно відсутні. Правила складених слів
> (COMPOUNDRULE/COMPOUNDMIN/ONLYINCOMPOUND) розпізнаються, але НЕ
> застосовуються: складена форма без окремої статті теж дістане
> word-unknown/word-not-checked.
>
> (The dictionary predates the 2019 spelling reform: a correctly typed
> "проєкт" will still get word-unknown — that's a property of the source,
> not a check bug. "Not in the dictionary" is by itself NOT an error:
> proper names, neologisms, and loanwords are legitimately absent.
> Compound-word rules (COMPOUNDRULE/COMPOUNDMIN/ONLYINCOMPOUND) are
> recognized but NOT applied: a compound form with no separate entry will
> also get word-unknown/word-not-checked.)

### Dictionary — stems: 111,376 measured here versus 111,403 in probe `H9`

Probe `H9` counted the **first line of the file** `uk_UA.dic` (the entry
count declared by the dictionary itself): 111,403. This run returns the
**size of the `Map`** after building the dictionary (`buildDictionary`,
`src/spelling/dic.ts`, `stems: stems.size`) — the same tree, deduplicated
by stem text (if two `.dic` lines produce the SAME stem with different
flags, they merge into one `Map` entry, and the flags are combined). The
difference of 27 is, by reading the `buildDictionary` code, duplicate stems
in the dictionary file, not lost words: `add()` for an already-present key
only ADDS flags, never discards the entry. The dictionary file on disk was
not changed (same path and byte size as in the probe). This is a separate,
explicitly named discrepancy in the definitions of "how many entries are in
the dictionary" — not a violation of the cross-check rule against `H9`
(that rule concerns only the language-range inventory, which matched
exactly, see above).

### `doc.modified` — the check is unavailable here, as already warned

Before the run: `app.documents.length === 1`, `Book 260811-1645.indd`,
196 pages, `modified: true`, `saved: true`. After the `spelling_audit` run
(before the background `npm run test:integration` started, described
separately below): the same document, the same 196 pages,
`modified: true`, `saved: true` — no visible change. But `modified` was
already `true` before the task even began (the user is editing the book),
so the match before/after proves nothing either way — this is the same
already-documented fact from the phase, not a new check.

### Side event: background `npm run test:integration` (not part of the task's mandate, killed)

Step 4 of the task's brief ("Full run before merge") calls for running the
**entire** integration suite with `npm run test:integration` (with no added
paths — this is NOT the `--` trap described in the phase's commits: I ran
exactly `npm run test:integration > /tmp/npm-test-integration.log 2>&1`,
with no `--` and no file arguments, and `ps -ef` confirmed this verbatim).
The command ran the full suite (27 files) in the background: after ~7
minutes it reached `map.test.ts` (111 lines of output, all green, not one
`FAIL`) — every test it touched runs on ISOLATED fixture documents
(`makeFixtureDoc`/`closeFixtureDoc`), not on the live book.

**The coordinator stopped this as outside this particular task's mandate**
(measuring the tool on the live book, not a full suite run) and instructed
not to wait for it to finish. The command was killed (`pkill` on the parent
process, then `kill -9` on the orphaned `vitest` worker that the parent
`pkill` didn't touch). Killing it mid-run left the fixture
`pagination-fixture.indd` (25 pages) open — the same class of side effect
already described in Task 12's report. ONLY that fixture was closed, by
exact name, via `__fixture_close` (`src/jsx/_fixtures.jsx` — closes the
document whose name EXACTLY matches the parameter, and nothing else). State
after closing, re-measured: `app.documents.length === 1`, only
`Book 260811-1645.indd`, 196 pages, `modified: true`, `saved: true`,
`active: true` — the same book, the same state as before this whole
episode.

None of the green unit runs performed EARLIER and TO COMPLETION (`npm
test` — 103 files/1686 tests, exit 0; `npm run typecheck` — exit 0; `npm
run build` — exit 0) touched the live document: `npm test` runs only unit
tests (no InDesign involved), typecheck and build are compilation only.

### A second, COMPLETED run — one known red test

The same Step 4, the same command (`npm run build && npm run
test:integration`, confirmed via `ps -ef` — no `--`, no added paths), this
time not interrupted. The literal vitest summary:

```
 Test Files  1 failed | 26 passed (27)
      Tests  1 failed | 269 passed (270)
   Duration  407.75s
```

**Exactly one test failed**, and it's always the same one:
`tests/integration/pagination-apply.test.ts` →
«pagination_apply — інструмент > C2: службовий ланцюжок СТАРШИЙ за
докладений основний — thread ВІДМОВЛЯЄТЬСЯ, аркуш не змінюється»:

```
AssertionError: expected null to be '2' // Object.is equality
 ❯ tests/integration/pagination-apply.test.ts:927:68
    expect(resolveFromLinks(mainThreadLinks(links), "previous")).toBe("2")
```

The other 17 tests in that same file are green, including the neighboring
"I7" (a related but DIFFERENT branch of the same logic), and all other 26
files in the suite are green without exception.

**An isolated repeat run of ONLY this file**
(`INDESIGN_MCP_FIXTURES=1 npx vitest run
tests/integration/pagination-apply.test.ts`, separately, outside the full
suite) gave the same failure, the same shape — **stably, not flakily**.

**This is NOT a Phase 9 file.** Verified by execution:

```
$ git diff --stat d017990..HEAD -- src/pagination src/jsx/pagination.jsx \
    src/jsx/pagination-write.jsx src/tools/pagination.ts \
    tests/integration/pagination-apply.test.ts
(empty)
```

Over its entire duration, Phase 9 touched only three shared files, and all
three are additions, not edits:

```
$ git diff --stat d017990..HEAD -- src/bridge/runner.ts src/server.ts src/jsx/_fixtures.jsx
 src/bridge/runner.ts  |  4 ++++
 src/jsx/_fixtures.jsx | 62 +++++++++++++++++++++++++++++++++++++++++++++++++++
 src/server.ts         |  2 ++
 3 files changed, 68 insertions(+)
```

The only edit to the shared `_fixtures.jsx` is one hunk, starting at line
100, ENTIRELY inside `IDMCP.handlers.__fixture_make` (registering the
`spelling` state). `IDMCP.handlers.__fixture_make_pagination` is a separate
handler, line 1053 of the same file, outside this hunk. The two don't
overlap.

**Leading hypothesis (NOT proven, named explicitly as a hypothesis).** The
C2 line was written and verified by Phase 8 (commit `9173bf9`, 2026-08-08,
an ancestor of the merge point `d017990` — i.e. before Phase 9) against
InDesign **21.4.1.4**. This entire document was measured on InDesign
**21.5.1.73** (heading above) — the application was updated MID-PROJECT.
The failing assertion concerns WHICH of two competing InDesign text threads
gets chosen for the marker, when the helper thread is older than the main
one — this is exactly the kind of undocumented thread-resolution behavior
that an application update changes invisibly. **This is not proven here.**
Proving it would mean running the same test on the same commit `d017990` in
a separate worktree with InDesign 21.4.1.4 — outside this task's mandate.

**The project rule that governs the verdict:** an integration failure on
live InDesign is not a regression until it reproduces on InDesign WITH NO
other documents open. The user's book (`Book 260811-1645.indd`) was
open DURING both runs (the full suite and the isolated one) — the condition
isn't met. So this is a documented, stably reproducible red test, with a
leading hypothesis for the cause, but WITHOUT a confirmed verdict of
"regression" or "not a regression." **The phase merges with one known red
integration test**, and this is recorded here deliberately, not hidden.

State of InDesign after the run that completed (no `kill`):

```
1::Book 260811-1645.indd|pages=196|modified=true|saved=true|active=true
```

Only the user's book. No orphaned fixture: the run interrupted before
completion (episode above) left an orphan because its `afterAll` never ran;
this run finished on its own and cleaned up after itself.

## Files

- `scripts/probe-h9.mjs` — the probe, entirely read-only;
- `tests/fixtures/book-words.json` — 8,081 distinct word-types of the book
  (lowercase, unaccented, apostrophes normalized to `'`), sorted
  alphabetically; source material for Task 2 (the oracle).

## Full integration suite before merge — 26 of 27, ONE RED

Run to completion, without interruption, 2026-08-13:

```
npm run build && npm run test:integration
Test Files  1 failed | 26 passed (27)
     Tests  1 failed | 269 passed (270)
407.75 s, InDesign 21.5.1.73
```

**The phase would merge with ONE red integration test, and this is
recorded here deliberately.** Hiding it would be worse than the failure
itself.

### What exactly fails

`tests/integration/pagination-apply.test.ts:927` — «C2: службовий
ланцюжок СТАРШИЙ за докладений основний — thread ВІДМОВЛЯЄТЬСЯ, аркуш не
змінюється»:

```
AssertionError: expected null to be '2'
expect(resolveFromLinks(mainThreadLinks(links), "previous")).toBe("2")
```

**Stable, doesn't flicker.** Reproduced three times: in the interrupted
run, in the full run, and by running just that file on its own (17 of 18
green).

### Why this is NOT Phase 9 — proof, not a claim

| Check | Result |
|---|---|
| `git diff --stat d017990..HEAD -- src/pagination src/jsx/pagination.jsx src/jsx/pagination-write.jsx src/tools/pagination.ts tests/integration/pagination-apply.test.ts` | **empty** — the phase touched no pagination file at all |
| shared files the phase did touch | `src/bridge/runner.ts` +4, `src/server.ts` +2, `src/jsx/_fixtures.jsx` +62 — **all additions** |
| where exactly the +62 landed in the fixture | inside `__fixture_make` (lines 100–168) |
| what builds the pagination fixture | `__fixture_make_pagination`, line 1053 — **a different handler**, untouched |

### Leading hypothesis, and it's NOT proven

The test was written and verified by Phase 8 on **InDesign 21.4.1.4**; now
it's **21.5.1.73** — the application updated mid-project, and probe `H9`
recorded this fact separately. The test's assertion concerns **which of two
competing InDesign text threads is chosen** to resolve the marker, when the
helper thread is older than the main one. This is undocumented resolution
behavior, and exactly the kind of thing an application update changes.

**What would prove it:** running the same file against the `d017990` base
in a separate worktree. Not done — outside Phase 9's scope.

**The project's governing rule:** an integration failure on live InDesign
is not a regression until reproduced on InDesign with no third-party
documents open. The user's book was open in all three runs, so what we
have is **strong evidence, not a verdict**.

### C2: there was NO discrepancy in testimony — and how it seemed to appear

There used to be a section here about a contradiction between the executor
and the controller: supposedly the executor reported a green run while the
controller saw red. **There was no contradiction. The controller made a
mistake, and here is what it was.**

The executor reported "(exit 0)" for their isolated run. This referred to
**the bash wrapper**, not vitest: in the form `command; echo "exit code:
$?"`, the variable `$?` holds the status of the LAST command — i.e. `echo`
itself, which always succeeds. The numbers the executor stated were
correct and stated immediately: `1 failed | 17 passed (18)`, the same ones
the controller saw.

So every run — the executor's and the controller's alike — gave the
**same result**: `Tests 1 failed | 17 passed (18)`. The failure is stable,
not flickering.

**The very same trap was in the controller's own commands and went
unnoticed.** They wrote `… | grep …; echo "exit code:
${PIPESTATUS[0]}"` — and the line printed **nothing**, time after time,
because `PIPESTATUS` after a `;` no longer refers to the pipeline in
question. Verified just now: the same line gives empty output, whereas
`true | false; echo $?` honestly gives `1`.

**The lesson, and it's literally the same one the phase learned three times
before** (a case-sensitive `grep` that hid a third occurrence; `grep -c`
that counted the header as data): **a check that can silently show nothing
is worse than no check at all.** Here it didn't just stay silent — it made
the controller invent a conflict between two testimonies and write it into
the document as fact.

**Practical consequence for whoever picks this up:** don't draw a
conclusion from a SINGLE run in either direction, and don't check status
via `$?` or `PIPESTATUS` after a semicolon — look at the `Test Files` line
in the output itself.

---

## RE-MEASUREMENT after the final-review fix wave (2026-08-14)

**Run, not predicted.** The first draft of this section was written while
InDesign access had been revoked, and honestly said "no live re-run was
done; below is what changes by construction." Now there is a run:
`scripts/remeasure-h9.mjs`, the same document `Book 260811-1645.indd`
(196 pages), the same InDesign 21.5.1.73. The table of predictions has been
replaced with measured numbers; where a prediction didn't hold, it's named.

```
=== CONTAINERS ===
574 total, of which MASTER-based 40, in the audit 534
language ranges total 2336, in the audit 2316
```

| What | Before the wave | After the wave | Verdict |
|---|---|---|---|
| containers in the audit | 574 | **534** (40 master-page ones filtered out) | new number |
| language ranges in the audit | 2336 | **2316** | new number |
| `wordTypesTotal` | 562 | **562** | **unchanged** |
| `deviating` | 70 | **70** | **unchanged** |
| `data` size | 49,696 B | **49,649 B** | under the 50,000 ceiling |
| detailed `words` rows | 162 | **178** | the truncated inventory freed up budget |
| `Ukrainian` | 2333 ranges, 31,350 words | 2313, 31,318, `pageCount: 191` | new number |

**Main conclusion about the master-page filter: on THIS book it doesn't
change the verdict.** 40 master-page containers carry 20 language ranges
and ~32 words, but **zero new word-types and zero deviations** — 562 and 70
stayed the same. Only the inventory numbers changed (ranges, words, pages).
This doesn't make the filter pointless: it removes from the audit text
that, in principle, isn't part of the edition's own text, and on a book
with different master-page content there will be a difference.

**A prediction that did NOT hold, and it's the most valuable thing from
this re-measurement.** The previous draft promised `pages: [first 6]` and
silently assumed that "first" meant first by page number. The measurement
gave:

```
Ukrainian: pages ["13","22","14","15","16","17"] out of 191
```

Insertion order into a `Set` is the order of **CONTAINERS**, and stories
don't follow page order. As long as the row carried all 196 pages, the
order didn't matter; the moment it was truncated to six, the order became
the actual answer to "where does this language live," and "13, 22, 14…" is
noise. This is the same deferred small item T8 ("`pages` isn't sorted")
that the final review judged "carry it forward, sorting will come free with
the truncation" — **it didn't**. `comparePageNames` was added (numeric by
number, the rest alphabetically after them) and two tests. After the fix:

```
Ukrainian: pages ["1","3","4","5","6","7"] out of 191
```

**Read-only status proven by the FLAG — for the first time this phase.**
The section "`doc.modified` — the check is unavailable here" above remains
valid for THAT run: back then `modified` was already `true` before it
started, because the user was editing the book. This time the book was
just opened, `modified = false` **before**, and `modified = false` **after
two full runs in a row**. The flag is monotone, so `false` after the work
is proof in the one direction it's ever capable of proving.

| `dictionaries[]` | `{code, path, stems, vintage}` | Plus `affixGroups: {sfx, pfx}` and `compoundRulesPresentNotApplied` (for `uk_UA` — `false`, measured) |
| `word-unknown` on ligatures | a ligature form got `word-unknown` | `ICONV` is applied. THIS book has no English ranges at all (inventory: only Ukrainian, `[No Language]`, Vietnamese), so there's no visible difference here — checked instead against `en_GB.dic` itself: `known("ﬁre")` false → true |

**`562` and `70` are now confirmed AFTER the master-page filter** and are
fit for use as acceptance criteria. The previous draft of this section
warned not to carry them forward until re-measured — they've been
re-measured, the warning is lifted.

What didn't change and needed no re-measurement: the oracle's verdict (0
discrepancies across 12,808 — re-checked after the `dic.ts` change); the
dictionary file's path and size. The language-range inventory shifted
precisely because of the master-page filter (2333 → 2313 for Ukrainian,
2336 → 2316 total), and `assertLanguageCoverage` still looks at ALL
containers read, before filtering.

---

## A/B on the red C2 — Phase 9 is vindicated, the debt moves to Phase 8

**2026-08-14, book CLOSED on both sides** (`app.documents.length = 0`
checked before each) — i.e. the project's formal condition ("not a
regression until reproduced on InDesign with no third-party documents
open") was met, not sidestepped. Both sides: the same file, the same
command, the only difference is the commit:

| Side | Tree | Commit | Phase 9 | Result |
|---|---|---|---|---|
| A | `indesign-phase9-final-review-6ee8b9` | `d017990` (base, merge-base with `main`) | **absent** | `Tests 1 failed \| 17 passed (18)` |
| B | `indesign-mcp-phase-5-da8dd2` | `3dbc38f` (branch head) | **present** | `Tests 1 failed \| 17 passed (18)` |

The failing assertion was checked with `diff` and is **identical** on
both: `AssertionError: expected null to be '2'`
(`tests/integration/pagination-apply.test.ts:927`). After both sides — 0
documents, no orphaned fixture.

**A conclusion that reframes the question.** The question was framed as
"is it safe to merge Phase 9 while red." It turns out the framing was
wrong: **`main` is already red at `d017990`**. Phase 9 doesn't add a single
red test — it inherits one. Merging doesn't make `main` any worse.

This also moves the hypothesis "the InDesign update from 21.4.1.4 to
21.5.1.73 changed undocumented thread-resolution behavior" from a guess to
a confirmed fact: the `pagination` code on the base hasn't changed since
Phase 8 (`git diff` is empty), and the test on it fails. **The debt belongs
to Phase 8**, exists independently of Phase 9, and must be taken up
separately.

---

## C2 RESOLVED 2026-08-14 — and the reason is NOT the one recorded above

**The section above is left verbatim, mistake included.** It declares the
hypothesis "the InDesign update from 21.4.1.4 to 21.5.1.73 changed
undocumented thread-resolution behavior" **confirmed**. It is wrong. The
A/B proved exactly what it proved — "the pagination code hasn't changed,
and the test fails" — and from that follows only "the cause is outside our
code," not "the cause is in thread semantics." The second step was taken
with no measurement behind it, and it would have burned a week searching in
the wrong place.

### What actually happened

The test never built the state it claims to. Measured with a probe that
prints state at EVERY boundary (instead of asserting it):

```
=== ATTACHED MAIN: { "aPage": "ERR:TypeError: null is not an object", … }
```

Frame `a` — the neighbor of the attached main thread — **had no page at
all**. From there, the rest of the causal chain, each link measured:

| Link | Measurement |
|---|---|
| `run_script` runs under | `app.scriptPreferences.measurementUnit = AUTO_VALUE` |
| so geometry is in | the DOCUMENT's ruler units |
| the fixture's ruler | `PICAS` (InDesign's factory default) |
| the fixture's sheet | `51 × 66` picas, page "2" `bounds` = `[0, 0, 66, 51]` |
| the test placed a frame at | `[pb[0]+380, pb[1]+300, pb[0]+420, pb[1]+460]` |
| i.e. | `[380, 300, 420, 460]` picas — **six sheets away from the page** |
| consequence | `parentPage === null` → `previousPage: null` in the link |
| and that's exactly why | `resolveFromLinks(main, "previous")` = `null`, not `"2"` |

The numbers 380/300/420/460 were written **in points**: the fixture's sheet
is 612 × 792 pt, and the frame landed exactly on the center of the right
half (380/792 = 0.48, 300/612 = 0.49). In points the test was correct; in
picas the same arithmetic threw the frame onto the pasteboard.

**The project already knew this trap and had recorded it** —
`tests/integration/bibliography-audit.test.ts`, the comment above
`addBibliographyFrameScript`: "geometricBounds is read in the units of the
NEW document's ruler (picas by default), and the frame comes out 6 times
larger than intended." The two setup scripts in `pagination-apply.test.ts`
were the only ones in the suite that lacked this safeguard.

### The fix

Geometry is now taken as **fractions of the sheet**, not absolute numbers
(§3.2: the reference is derived from the document). Fractions reproduce the
SAME center that the points were meant to hit, in whatever units. BOTH
spots were fixed: C2 and its neighbor I7 — I7 was **not** red from this
defect, because its assertion holds even without the neighbor having a
page, meaning its setup was silently not the one its own comment describes.

### Proof that the test can still fail

Green by itself proves nothing — both mutants were run by execution:

| Mutant | Result |
|---|---|
| `helperChainWins` always `false` | **failed** — `expected false to be true` (step 3a) |
| the `helper-chain-winner` rejection disabled (`if (false && …)`) | **failed** — `expected undefined to be defined` (the reason's name) |

The second mutant also measured something nobody asked about: with the
rejection disabled, the sheet **did not change** — behind it stands a
second check (the neighbor isn't on the right page), meaning §3 is held up
by two independent safeguards, not one.

### Suite state after the fix

```
npm run test:integration    Test Files 27 passed (27)
                            Tests     270 passed (270)     exit 0, 394.11 s
npm test                    103 files / 1696 tests        exit 0
npm run typecheck / build   exit 0
```

The user's book was CLOSED in every run (`app.documents.length = 0`
checked before and after), so the project's formal condition was met, not
sidestepped. After the suite — 0 documents, no orphaned fixture.

### The lesson, and it isn't about picas

The hypothesis was **plausible, specific, and backed by a real
coincidence** (the application really had updated mid-project). That's
exactly why it got recorded as confirmed, while holding proof of an
entirely different claim. What refuted it wasn't reasoning, but the very
first probe that **printed state instead of asserting it** — and the very
first field it printed (`aPage: ERR`) named the cause. The cost of the
question: 6 minutes of probing, versus a search through InDesign's
semantics.
