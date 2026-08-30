# Spec — Chicago bibliographic description

Design for adding the Chicago Manual of Style as a third bibliographic
standard, and for a `bibliography_apply` write tool. Approved approach: a
dialect inside the existing pipeline (approach A).

Every number quoted here comes from
[`docs/measured-facts-chicago.md`](measured-facts-chicago.md), measured on
2026-08-27 against `main` at `0b846cf`.

---

## 1. Goal

Judge an English-language bibliographic description against Chicago rather
than against ДСТУ, and let a confirmed finding be written back into the
document.

### The first intended consumer turned out to be the WRONG one

This section originally named the CIP record on page 4 of the translated
edition as the target, and proposed converting it to:

```
Surname, Firstname. Title. City: Publisher, 2026.
```

**That target is withdrawn, and the reason is §10.** The edition carries a
Ukrainian ISBN, so it is a Ukrainian publication whose text happens to be
English — and its imprint is governed by ДСТУ 4861 BY PLACE OF PUBLICATION,
not by the language of the text. The record on page 4 is not a citation of
somebody else's book; it is the edition's own catalogue-card block, whose
form that standard prescribes. Converting it to Chicago would break the
standard that actually governs the page.

The distinction was already written into §10 before any code existed. What
was missing was applying it to §1 — a target can be approved and still be
wrong, and leaving it standing would have sent the next reader to convert
the one record in this book that must not be converted.

**So this family has no consumer in this book at all.** Measured: the
edition contains no bibliography — no `http`, no `et al.`, no source list
(§3 of the measured facts). The live run finds seven findings on the CIP
record, and none of them should be applied.

Its consumers are future books: an English edition carrying a source list,
and a Ukrainian academic work whose sources are in Latin script — which is
also the one case the Cyrillic gate exists for (§8.5 of the measured facts).

### Non-goals

- APA, MLA, ISO 690, Harvard. Naming them costs nothing and implementing
  them costs a parser each.
- Converting the Ukrainian edition. Chicago must be inert on it.
- УДК, the author's mark, and the ISBN. They are Ukrainian
  cataloguing requisites, confirmed by the author, and they stay.
- Chicago's notes (footnote) form. Only the bibliography-entry form is in
  scope; the note form differs in punctuation and has zero material here.

---

## 2. The two structural obstacles

**Segmentation.** `segmentContainer` opens a record only on a numbered
paragraph. Chicago entries are unnumbered, which is why the existing audit
returns `records: 0` on this edition and files 1866 paragraphs as
`heading`. Chicago needs its own segmenter — this is the bulk of the work,
not the rules.

**The `Standard` union.** `Standard` is `"7.1" | "8302"` and flows into
`DSTU_RULES.check(parsed, standard)`. Widening it would hand every ДСТУ
rule a value it has no branch for and the miss would be silent. The
dispatch must SELECT the family; the union must not grow.

---

## 3. Architecture

New modules, all string-only — the directory keeps knowing nothing about
InDesign:

| module | responsibility |
|---|---|
| `src/bibliography/segment-chicago.ts` | paragraph-block → entries |
| `src/bibliography/parse-chicago.ts` | entry → Chicago zones |
| `src/bibliography/rules-chicago.ts` | the rule family |
| `src/bibliography/latin.ts` | Latin character classes |

Unchanged and reused: `report.ts`, `uniformity.ts`, `rules-nbsp.ts`,
`nobreak.ts`, `chars.ts`.

`types.ts` is touched in exactly one way — `ZoneId` gains four members
(§5). `Finding`, `BibRecord`, `ParsedRecord` and `Zone` keep their shape,
which is what lets the report and uniformity layers stay untouched.

Dispatch lives at exactly ONE place, `collectAudit` in
`src/tools/bibliography.ts`:

```
standard = "chicago"  →  segmentChicago  →  parseChicago  →  CHICAGO_RULES
standard = "7.1"|"8302" → segmentContainer → parseRecord  →  DSTU_RULES
```

`Finding`, `Zone`, `ParsedRecord` and `BibRecord` are shared verbatim, so
`buildReport`, `measureUniformity` and the whole nbsp layer work on Chicago
output without being told about it.

### The `layers` parameter stops lying

Today `layers` is `["dstu", "nbsp"]`, where `dstu` names a standard and
`nbsp` names a layer. Under two standards that was merely untidy; under
three it becomes a contradiction a caller can express
(`standard: "chicago", layers: ["dstu"]`).

The enum becomes `["standard", "nbsp"]`. `"dstu"` is accepted as a
deprecated alias for `"standard"` so existing calls keep working. The
standard is chosen by `standard` and by nothing else, so no contradiction
is representable.

---

## 4. Chicago segmentation

**A Chicago entry is one paragraph.** Chicago bibliographies set entries
with a hanging indent, so continuation lines are soft wraps, not
paragraphs — the opposite of the ДСТУ index, where block-based segmentation
was required.

One exception is measured: the CIP record puts its heading on its own
paragraph (`Surname Firstname.\rTitle / …`). So a paragraph that is ONLY a
heading — an author-shaped opener with nothing after the final period —
attaches to the paragraph that follows.

**An entry needs an opener AND a discriminator.** The opener alone repeats
the exact trap ДСТУ hit, where 1866 prose paragraphs qualified.

| | default |
|---|---|
| opener | inverted personal name whose SECOND token looks like a given name (`Ann` or `J.`), or Chicago's 3-em dash `———.` for a repeated author |
| discriminator | a four-digit year, OR `Place: Publisher`, OR a URL |

Both are exposed as the SAME two parameters ДСТУ already has —
`recordPattern` and `recordDiscriminator` — with Chicago defaults. What the
tool cannot know about a layout stays a declared parameter rather than a
constant derived from this one book.

**Two things in this section were corrected BY THE LIVE RUN, after the code
was written. Both are recorded here rather than quietly amended.**

*The opener demanded too little.* It first required only a capital letter as
the second token. On the English edition that opened FIVE false entries out
of six — «When I found out…», «Today I'm a mom…», «Do NOT rely on…» — the
ДСТУ trap reached by another road. The unit test written to prevent exactly
this had picked prose whose second word was lowercase, which is not what
English prose looks like, so it proved nothing.

*A quoted phrase is not a discriminator.* That alternative let every one of
those five through, because running prose is full of quoted words. It is
removed and nothing is lost: a Chicago article entry carries a year too.

**Cyrillic gate.** A paragraph containing a Cyrillic letter is not opened,
and is reported as skipped with THAT reason rather than as a heading — the
distinction matters, because "this looked like a section title" and "this is
not our material" are different statements.

A script test, not a read of InDesign's language attribute: the attribute
costs a separate bridge call and, on a localised build, the language-name
comparison silently yields zero — the failure mode `typography_audit` has to
carry as `ukrainianRuns`. A script test cannot fail that way.

**Its measured value is smaller than this section first claimed.** Disabled
and re-run against all three books, the outcome does not change: same
records, same findings, only the skip reason differs. The Latin-only opener
is what actually keeps Cyrillic out. The gate is kept for a case these books
do not contain — a Ukrainian work with a Latin-script source list — and that
protection is unit-tested, not measured on real material.

What it does NOT do: make the segmenter safe on an English book whose prose
carries years. That is why the counts are reported and why apply is gated on
the record count in §7.

---

## 5. Chicago zones

`ZoneId` gains `publisher`, `place`, `year`, `url`. `heading`, `title`,
`subtitle`, `extent` and `notes` are reused; `responsibility` and `source`
keep their meaning.

As in ДСТУ, **the parser is not a judge**: it must recognise `City :` as
the place zone even though the space before the colon is exactly what a
rule will complain about. A parser that only accepted correct punctuation
would leave every rule with nothing to point at.

---

## 6. The rules

Six, each carrying its CMOS clause in `Finding.basis`.

| id | finds | proposes | confidence |
|---|---|---|---|
| `chicago-heading-comma` | inverted name without a comma | `Surname Firstname.` → `Surname, Firstname.` | high |
| `chicago-zone-separator` | ГОСТ « . — » between zones | ` . — ` → `. ` | high |
| `chicago-colon-spacing` | space before the place/publisher colon | `City :` → `City:` | high |
| `chicago-responsibility-repeat` | ` / Author` repeating the heading | delete the zone | high |
| `chicago-extent` | a page-extent zone | delete the zone | **needs-review** |
| `chicago-publisher-caps` | publisher in full caps | `PUBLISHER` → `Publisher` | **needs-review** |

The last two are deliberately not `high`.

`chicago-extent`: Chicago omits extent from a bibliography entry, but a CIP
block legitimately carries it, and here the value is not even a literal —
it is the `U+0018` page-number marker that composes to `196`. Deleting it
destroys a live marker.

`chicago-publisher-caps`: the copyright block four lines below writes
`© 2026 PUBLISHER™`. That is the house's own SPECIMEN of its
name, not a typesetting slip. A rule that cannot tell a specimen from a
usage is the defect Phase 14 found in two detectors out of five, and it
reached `main` past seven reviews. Here the gate is explicit: the rule
reports, and a human decides.

---

## 7. `bibliography_apply`

The write machinery already exists and is reused whole: `runWrite` →
`apply_edits`, `backupStamp`, `assertExpectedDoc`, single undo step, backup
into `_backups/` before the first write. `Finding` already carries
`containerId`, `start`, `end`, `before` and `suggested` in CONTAINER
coordinates, which is exactly `apply_edits`' input.

Parameters mirror `typography_apply`: `ruleIds` (min 1), `standard`,
`includeNeedsReview` (default `false`), `undoName`, `expectedDocName`.

**One gate is new, and it exists because of §4.** `typography_apply`
confirms BY RULE, not by match — sound when a rule's matches are trusted,
dangerous when a segmenter might have opened false entries. So
`bibliography_apply` also takes `expectedRecords`: the record count the
caller saw in the audit. If the live count differs, the tool refuses and
writes nothing. A layout that changed under the caller, or a discriminator
that behaved differently, then surfaces as a refusal instead of as edits
to paragraphs nobody reviewed.

---

## 8. Refusals

The tool fails loudly, never silently, on:

- a `ruleIds` entry that exists in no family for the chosen standard —
  reporting what IS available, as `typography_apply` does;
- `expectedRecords` not matching the live count;
- `expectedDocName` not matching the active document;
- the existing `assertNoBreakAnswersMatch` mismatch.

---

## 9. Testing

- **Unit, per rule**, on Chicago Manual of Style specimen entries. The
  specimens are taken from the standard's own published examples rather
  than invented: an entry printed by the standard is evidence, an entry
  written to pass a test is not.
- **One fixture reproduces the live record's FORM exactly** — every
  character class in place, including its `\r`, its forced line break `\n`,
  its `U+0018` and its spacing. A fixture tidied for convenience checks a
  tidied world; the last time that shortcut was taken, the rule would not
  have fired on the real document.

  Proper nouns in it are substituted, and that is not tidying: the privacy
  gate forbids the repository to carry an edition's identity, and none of
  these rules depends on which name stands there. What must survive
  verbatim is the shape — a missing comma, a repeated author after ` / `,
  a « . — » separator, a space before the colon, an all-caps publisher, and
  a page-number marker where a number is expected. The distinction is worth
  stating because the two requirements otherwise look contradictory.
- **Segmenter tests** must include the negative case: this book's own prose
  paragraphs must not open entries.
- **A gate test that `Standard` still has exactly two members**, so §2's
  hazard cannot return unnoticed.
- **A gate test that a ДСТУ rule is never constructed when
  `standard: "chicago"`.**
- **Integration**: a live run on the print edition, expecting the six
  findings on `story:245` and nothing on `story:243`, `244`, `248`, `249`.
- **The Ukrainian edition must be opened and run** before the family ships,
  to measure that the Cyrillic gate makes it inert. This is currently NOT
  measured — the document was not open.

---

## 10. This is a citation style, NOT a CIP block

Written down because the two are easy to confuse, and confusing them would
send a later reader looking for a conformance this tool never claimed.

**Chicago is a style for CITING someone else's book.** It says how an entry
in a bibliography should read. It says nothing about what must appear on
the copyright page of your own book.

**An imprint block is a CATALOGUING requisite**, and a different family of
documents governs it:

| jurisdiction | what governs the block | nature |
|---|---|---|
| Ukraine | ДСТУ 4861:2007 «Видання. Вихідні відомості» | national standard; the source of the record this tool converts |
| USA | Library of Congress **CIP Data Block**; **LCCN** | voluntary programme, format prescribed by LC |
| UK | **British Library CIP**, administered by Bibliographic Data Services; records feed the British National Bibliography | voluntary programme (verified 2026-08-27) |
| international | **ISO 1086** — title leaves of books; **ISO 2108** — ISBN; **ISBD** (IFLA) — the description structure ГОСТ 7.1 derives from | international standards |
| Germany, Austria | **Impressum** under the Länder press laws | an actual legal requirement |
| France | **dépôt légal** under the Code du patrimoine — the notice with month and year | an actual legal requirement |
| USA | **ANSI/NISO Z39.41** — placement of information on spines | current (verified 2026-08-27); adjacent, not about the imprint |

So the target form in §1 makes the record read as an English-language
book's self-description with the ГОСТ punctuation gone. **It does not make
it a US CIP block**, which is a labelled, MARC-derived structure of a wholly
different shape:

```
Names: Surname, Firstname, author.
Title: …
Description: City : Publisher, 2026. | Includes index.
Identifiers: LCCN … | ISBN …
Subjects: LCSH: …
Classification: LCC … | DDC …
```

A real CIP block cannot be produced by a layout tool at all: it is issued
by the Library of Congress on a publisher's advance application, or bought
as a PCIP record from a private cataloguer. For Amazon KDP neither is
required — an ISBN and a copyright notice suffice.

**Two claims were checked and did NOT verify**, so they appear nowhere in
this repository as facts: `BS 4719` (title leaves of a book) and
`ANSI/NISO Z39.15` (title leaves of a book). Z39.15 does not appear in
NISO's current published-standards list, and no source for BS 4719 was
found. Not found is not the same as does not exist — but it is also not the
same as verified, and neither may be cited until someone reads the
registry itself.

---

## 11. What is deliberately left out

- No language-attribute read. The script gate covers the need at a fraction
  of the cost and without the localised-build failure mode.
- No `containerIds` restriction on the audit. It would make false entries
  less likely, but the counts are reported and apply is gated on them; a
  new parameter earns its place after a book where the gate proves
  insufficient.
- The `en-dash-parenthetical-us` typographic exception stays exactly as it
  is. After conversion its material disappears from THIS edition, but it
  protects the Ukrainian edition and any unconverted English one. The two
  must not be made to depend on each other.
