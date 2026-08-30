# InDesign MCP

An MCP server that automates Adobe InDesign layout work on macOS: a live
document exposed as 24 read/audit/write tools, plus a JSX escape hatch for
one-off scripting. Read tools measure the document; audit tools return
findings with proposed fixes and change nothing; write tools apply changes
through a safety envelope (see [Safety model](#safety-model) below).

**Every audit also reports what it did not check.** That is the design centre,
not a footnote: a prepress tool that answers "no problems found" without saying
what it looked at is worse than no tool, because it converts an unexamined
layout into a confident one.

## ✨ Features

- **Twenty-four tools over a live document** — not a file parser. The layout
  stays open in InDesign, and every measurement is of what is on screen.
- **Audits that report candidates, not verdicts.** Every audit carries an
  explicit coverage field — `caveat`, `skipped`, `notMeasured`, `notCompared`,
  `unmeasurableLinks`, `rulesDisabled` — so a zero that means "clean" is
  distinguishable from a zero that means "nobody looked". Measured example:
  on a `[Basic]` preflight profile `preflight_document` reports zero
  violations **and** that 32 of 38 rules were switched off, naming them —
  including image resolution, so that zero says nothing about resolution.
- **Three typographic schools** — Ukrainian, Chicago and Oxford, chosen per
  call, with the language gate that stops one from corrupting the other.
- **Prepress checks a print shop would run**: total ink coverage, rich black
  under small type, spot colours and ink count, image resolution, bleed
  crossings, broken links, native preflight with its coverage stated.
- **Pagination that repairs itself** — hand-typed folios and contents numbers
  replaced by self-updating markers through a purpose-built helper thread.
- **A write envelope, not a promise**: a backup copy, disabled modal dialogs,
  one undo step per batch, and a text check immediately before each write.
- **A standalone CLI** that runs the same checks and emits a bilingual HTML
  report.

<a id="status"></a>

## 📊 Status

Working software, not a released product — version 0.1.0, nothing published to
npm.

It has been run against the layouts of **three real books**: a 196-page
Ukrainian non-fiction title (four placed images in the whole book — a text
book, not an illustrated one), **its English edition**, prepared for Amazon in
print and digital versions, and a 592-page Ukrainian bibliographic index — plus
the first book's separate cover and endpaper documents. All were audited
read-only; the write tools were exercised on copies, never on a production
file.

Every InDesign behaviour these tools rely on was measured on live InDesign.
Where a book could not supply the case — a broken link, a disabled preflight
rule, a locked layer — the proof is a fixture instead, and the
`docs/measured-facts-*.md` files say for each detector which of the two it
rests on.

**The grounding is Ukrainian typesetting practice, and it shows.** The
Ukrainian typographic pack, the 2019 orthography rules and the ДСТУ
bibliographic rules were written against that practice and run over real
Ukrainian pages.

The English packs (Chicago and Oxford) were built against sentence samples and
fixtures — the measurements are in
[`docs/measured-facts-bilingual.md`](docs/measured-facts-bilingual.md) — and
the English edition above is the first real book to go through them. That run
paid for itself immediately: the Chicago dash rule matched at `high` confidence
on the book's **bibliographic imprint**, which `typography_apply` would have
rewritten without review.

The reason is worth stating, because no amount of Ukrainian testing could have
surfaced it. ДСТУ separates the zones of a bibliographic record with a *spaced*
em dash — and the Ukrainian convention wants a spaced em dash too, so the rule
has nothing to change and never fires. Chicago wants the dash *unspaced*.
Convention and standard first contradict each other on a **translated**
edition: the collision is created by switching the language, not by the text.
It is now guarded, and the guard reads the record's own shape (prescribed
punctuation, an ISBN) rather than a page number, so it holds for any edition.

**The English support now reaches the bibliography.** `typography_audit` has
three schools — Ukrainian, Chicago and Oxford. `bibliography_audit` has three
standards: the Ukrainian ДСТУ ГОСТ 7.1 and ДСТУ 8302, and the Chicago Manual of
Style. APA, MLA, ISO 690 and Harvard are still absent, and none is stubbed out
— material in those styles is judged by whichever standard you name, which is
the wrong answer rather than no answer.

Chicago is not a flag on the Ukrainian path; it has its own segmenter, and the
reason is measured. A ДСТУ record opens on a NUMBERED paragraph, and a Chicago
bibliography is unnumbered — so on the English edition the ДСТУ path found zero
records and filed 1866 paragraphs as headings. It broke nothing because it
parsed nothing. Chicago entries are also skipped wherever the text carries
Cyrillic, and the skip reports that reason, so an inert run stays
distinguishable from a clean one.

One boundary is worth stating, because it is easy to assume otherwise: Chicago
is a CITATION style. It governs how a source is described. It does NOT say what
a copyright page must contain — that is a cataloguing requisite (ДСТУ 4861 in
Ukraine, a Library of Congress CIP block in the USA), and no rule here produces
one.

Everything outside typography and bibliography is language-neutral by
construction: colour, geometry, resolution, ink coverage, pagination, styles
and preflight measure the document, not its language.

Two books is a small sample, and the audits will meet layout conventions they
have never seen. Most of them therefore report a finding as a candidate for a
human to judge; the ones that do issue a verdict say why in their own
description — `layout_audit` compares a paragraph against the style the
document itself declares for it, `bibliography_audit` against a published
standard.

## 📋 Requirements

- macOS
- Adobe InDesign 2026 (running, with a document open)
- Node 24+

## 🛠️ Installation

```bash
npm install
npm run build
```

Connect to Claude Code:

```bash
claude mcp add indesign -- node /path/to/indesign-audit-mcp/dist/server.js
```

On the first call macOS will ask for permission to control InDesign — grant
it. If access was denied earlier: System Settings → Privacy & Security →
Automation.

## 🎯 Quick start

Open a document in InDesign, then ask for a measurement before you ask for a
change. A first session usually looks like this:

```
Which document is open, and how big is it?          → indesign_status, doc_overview
Show me page 12 as it will print.                   → page_render
Check the typography, Ukrainian rules.              → typography_audit
Check ink coverage against a 300% limit.            → color_audit
```

Every audit answers with findings **and** with what it could not check. Read
that part: on a `[Basic]` preflight profile, for instance, 32 of 38 rules are
switched off, so "no violations" means six rules found nothing.

When you want a change applied, the audit's proposals go back through the
matching `*_apply` tool — which writes a backup first, wraps the batch in one
undo step, and re-checks the text at each position before touching it.

## 🧰 Tools

Twenty-four tools in eight groups. **Audit tools change nothing** — they
return findings with proposed fixes and leave the document alone; the six
that write are marked and explained under [Safety model](#safety-model).

### Read and inspect

Measure the document. None of these change anything.

| Tool | Purpose |
|---|---|
| `indesign_status` | Version, open documents, active document, `.indb` books |
| `doc_overview` | Pages, stories, styles, fonts, links, overset; optional `sections` and a `maxStories` cap — summaries are always complete |
| `story_read` | Text of a container with offsets and a per-page breakdown |
| `text_find` | Plain search (resilient to line breaks and quote style) or grep |
| `document_map` | Page map (spread side, parent page, frames with their thread links and overset) and a paragraph-style inventory; changes nothing |
| `page_render` | A raster image of ONE page or ONE spread — the PRINTED appearance; non-printing layers, guides, frame edges and thread lines never appear in the render; don't judge colour from it (PNG forces RGB — use `color_audit` for colour); resolution is set in pixels of the long side (`maxPx`, mutually exclusive with an explicit `dpi`); changes nothing |

### Corrections from a proofreader

A marked-up PDF or a “was → now” list, turned into reviewed edits.

| Tool | Purpose |
|---|---|
| `pdf_read_annotations` | Proofreader annotations from a PDF |
| `corrections_plan` | Dry run of edits with status and warnings |
| `corrections_apply` | Applies edits with a backup copy, one undo step, and a text check before each write |

### Typography and composition

Rules that a human confirms before anything is written.

| Tool | Purpose |
|---|---|
| `typography_audit` | Runs ONE LOCALE'S typography pack across the document, read-only (`locale`: uk / en-US / en-GB — see [Three typographic schools](#three-typographic-schools)); for `uk` also the 2019 spelling reform and an inventory of legal-variant pairs (`spelling2019`) |
| `typography_apply` | Applies confirmed rules in one undo step; `locale` must match the audit |
| `composition_audit` | Measures composition (line density, widows/orphans, hyphenation ladders, rivers, line-leading dashes) with proposed fixes; changes nothing |
| `composition_apply` | Writes selected proposals in one undo step, then re-measures |

### Pagination

Hand-typed page numbers that will not survive a recompose.

| Tool | Purpose |
|---|---|
| `pagination_audit` | Hand-typed text that asserts a page number — folios and table-of-contents numbers; summarised by defect, changes nothing |
| `pagination_apply` | Replaces hand-typed folio numbers with adjacent-page markers — three operations (build the helper thread, replace literals, repair the thread), dry run by default, with a backup and one undo step |

### Structure and styles

Where the layout has drifted from what it declares about itself.

| Tool | Purpose |
|---|---|
| `layout_audit` | Paragraphs that deviate from their own style, and pages detached from their own parent page; style-level summary by default, changes nothing |
| `styles_audit` | Paragraph-style hygiene: usage, overrides, scale, local character formatting (inventory, not defects), and `basedOn` inheritance — five families, summarised by style, changes nothing |

### Text quality

Standards and dictionaries, reported as candidates for a human.

| Tool | Purpose |
|---|---|
| `bibliography_audit` | Bibliographic-description rules under **three standards**: the Ukrainian ДСТУ ГОСТ 7.1:2006 and ДСТУ 8302:2015 (DSTU — *Derzhavnyi Standart Ukrainy*, the state standard; these govern how a bibliography is punctuated in Ukrainian academic and library publishing), and the **Chicago Manual of Style** for English-language material. Zone separators, ranges, prescribed punctuation, abbreviations, non-breaking spaces around initials and locators; separately measures whether inconsistent forms are a systemic defect or scattered noise. Chicago carries its own segmenter, because its entries are unnumbered. No APA/MLA/ISO 690/Harvard equivalent; changes nothing |
| `bibliography_apply` | Writes the confirmed bibliographic rules as a single undo step, after a backup. Confirmation is by RULE, not by match, so `expectedRecords` is mandatory and the write is refused when the live record count differs from the one you reviewed. `needs-review` findings are excluded by default |
| `spelling_audit` | Two families: `language` — where language settings are broken so spell-check silently doesn't run (`[No Language]` on live prose, a stray language tag), plus an inventory of every language in the document (no language is declared extraneous — that decision stays with a human); `dictionary` — words absent from InDesign's own dictionary (the bundled Hunspell) for the language actually applied to that range, reported per word-type with frequency; "not in the dictionary" doesn't count as a violation, and the dictionary check runs before the 2019 spelling rules (so a reform-compliant word like «проєкт» is a plain word-unknown, not conflated with a rule finding); changes nothing |

### Prepress

What a print shop will find if you do not.

| Tool | Purpose |
|---|---|
| `geometry_audit` | Four families: `frame` — near-misses against a reference edge (threshold has no default) and elements crossing the document's declared bleed; `image` — low resolution (threshold has no default) and broken/outdated links; `anchored` — an inventory of anchored objects and, when a named geometry rule is given (no default), an alignment check; `wrap` — non-printing or hidden text-wrap sources, and inconsistent wrap-inset within one population; changes nothing |
| `color_audit` | Five families: `tac` — total ink coverage above a declared threshold (default 300, ISO 12647-2); `black` — `[Registration]` on content, and rich black under a small point size; `palette` — unnamed swatches, and, when a threshold is named, near-misses against a reference swatch; `space` — non-CMYK and spot colours, an unexpected ink count; `overprint` — overprint on zero ink (sometimes unreadable on InDesign 21.5.1.73 — the caveat names how many places are affected); changes nothing |
| `preflight_document` | Native InDesign preflight with a mandatory caveat about what was actually checked: how many profile rules ran, how many were silent, and which ones; changes nothing |

### Escape hatch

For the task no tool covers yet — read the Safety model first.

| Tool | Purpose |
|---|---|
| `indesign_run_jsx` | Arbitrary ExtendScript for one-off tasks |

A standalone preflight CLI is also available: `npm run build:audit` bundles
a self-contained `indesign-audit` binary for running the same checks outside
an MCP client.

<a id="three-typographic-schools"></a>

## ✍️ Three typographic schools

The typographic rules are grouped into **locale packs**, chosen per call with the
`locale` parameter on `typography_audit` and `typography_apply`:

| | `uk` | `en-US` (Chicago) | `en-GB` (Oxford) |
|---|---|---|---|
| Outer quotes | « » | “ ” | ‘ ’ |
| Nested quotes | “ ” | ‘ ’ | “ ” |
| Parenthetical dash | ` — ` spaced em | `—` unspaced em | ` – ` spaced en |
| Double hyphen `--` | — | `—` | ` – ` |
| Dialogue dash | line-initial `-` → `—` | not applied | not applied |
| 2019 orthography | yes, language-gated | — | — |

The Ukrainian pack is the one with the most mileage: written against Ukrainian
typesetting practice and run across two real books. The English packs have been
through one real English edition, which immediately exposed a collision between
the Chicago dash and a bibliographic imprint — see [Status](#status).

A **shared core** is in all three packs and is genuinely language-neutral: space
collapsing, space before punctuation and brackets, the typographic apostrophe,
the ellipsis, and numeric ranges (`1939-1945` → `1939–1945`). The English packs
add an elision rule (`'90s` → `’90s` — the right single quote, which no word
processor gets right).

Why the split exists: run against English text, the Ukrainian pack produced 14
matches of which 8 corrupted it — guillemets around English speech, bullet lists
eaten by the dialogue-dash rule — and all 8 were at `high` confidence, meaning
`typography_apply` would have applied them by default. The measurement is in
[docs/measured-facts-bilingual.md](docs/measured-facts-bilingual.md).

### Two kinds of language binding

The packs distinguish two things that look alike and need opposite defaults:

- **Orthography** (`language`) is a **hard gate**. Applying Ukrainian 2019
  spelling inside a Russian quotation corrupts it — «проект» is a correct Russian
  word — so an unknown language means **refuse**, and the tool throws rather than
  guessing.
- **House convention** (`locale`) is a **soft selector**. Applying the wrong quote
  style is the wrong *style*, not corrupted text, and the operator states which
  school they want. An unknown language means **allow**, so the rules do not go
  silent on the many documents InDesign labels `[No Language]`.

When language ranges are readable *and* the document carries more than one known
language family, a convention match lying entirely inside another locale's
language is skipped and counted in `skippedByLocale` — that is what stops the
English pack from rewriting a Ukrainian quotation in a bilingual book.

That multi-family condition is not defensive coding, it closes a measured
hazard: **a new InDesign document defaults to `English: USA`**, so a Ukrainian
book whose typesetter never changed the language is English throughout. Without
the condition, `locale: "uk"` on such a book would skip every quote and dash
match and report a confident zero. `typography_audit` reports
`languages.observed` (the raw InDesign language names it actually saw) and
`languages.crossLocaleActive`, so a zero always reads as a zero.

What is deliberately **not** automated: British logical versus American syntactic
punctuation (`‘word’,` against `“word,”`) moves a comma across a quote mark
rather than substituting a character. A rule doing that cannot tell a quotation
from a title, so it is left to a human.

## 🔁 Applying corrections

1. Corrections arrive as an annotated PDF, a "was → now" list, or dictation
   in chat.
2. `corrections_plan` shows exactly what will change: page, context, status,
   warnings. The document is not touched.
3. You confirm the entries you want.
4. `corrections_apply` saves a backup to `_backups/`, applies everything in
   one undo step, and re-checks the text at each position before writing.

See [`docs/reference.md`](docs/reference.md) for the full mechanics —
including how the `new` field is normalized in the seam context before it's
written, and where plans and backups are stored.

## 📐 Composition and pagination audits

`composition_audit`/`composition_apply` measure and fix typographic
composition (tight/loose lines, widows/orphans, hyphenation ladders,
line-leading dashes, and more), calibrating natural space width from the
document itself rather than a font-metrics table.

`pagination_audit`/`pagination_apply` find and fix hand-typed page numbers
(folios and table-of-contents entries) that won't update on recompose,
replacing them with self-updating page markers through a purpose-built
helper thread with its own repair and drift detectors.

Both are read/write pairs with real limits, edge cases, and prerequisites
that matter before you run them on a real book — see
[`docs/reference.md`](docs/reference.md) for the complete rules.

## 🔐 Nothing about one book lives in this repository

The server is built for many editions, so it must not carry any one of them.
Titles, authors, editorial notes, ISBNs and barcodes, document paths, cover
proofs — all of that belongs to a book, not to a tool, and none of it is needed
to run the audits.

Everything private goes in **`private/`**, which `.gitignore` never lets into a
commit. Real edition configs live at `private/configs/*.json`; point the CLI at
them with `--config`:

```
node dist/cli/audit.js --config private/configs/my-book.json --out report.html
```

`configs/` holds only synthetic examples, safe to read and safe to publish —
copy one into `private/` and fill in the real values.

This is enforced rather than remembered.
[`tests/unit/privacy-gate.test.ts`](tests/unit/privacy-gate.test.ts) reads the
list of files git actually tracks and fails the suite on a home-directory path,
a real email address, an edition's ISBN, or a cloud-drive folder named after
someone's account. A reviewer checks once and forgets; the gate checks on every
run.

## 💡 Use cases

- **Handing a book to the printer.** Run the prepress group, read the caveats,
  fix what a human agrees is wrong. The CLI does the same pass unattended and
  produces an HTML report you can send on.
- **Applying a proofreader's PDF.** `pdf_read_annotations` → `corrections_plan`
  → you confirm → `corrections_apply`, with the text re-checked at every
  position so a shifted offset skips the edit instead of corrupting a sentence.
- **Taking over someone else's layout.** `document_map`, `styles_audit` and
  `layout_audit` say what the document declares about itself and where it has
  drifted from that.
- **A second language edition.** `typography_audit` with a different `locale`,
  and the language gate that keeps the English pack away from Ukrainian
  quotations in the same book.
- **After a reflow.** `pagination_audit` finds page numbers that were typed by
  hand and no longer match the page they sit on.

<a id="safety-model"></a>

## 🔒 Safety model

Six tools write to the document: `corrections_apply`, `typography_apply`,
`composition_apply`, `bibliography_apply`, `pagination_apply`, and
`indesign_run_jsx`.

The first four share one write path (`apply_edits` via `runWrite` in
[`src/bridge/envelope.ts`](src/bridge/envelope.ts)) and the same four
unconditional safeguards:

1. A backup copy in `_backups/`, made before any change.
2. InDesign's modal dialogs disabled for the duration of the write.
3. One undo step for the whole batch of edits.
4. A text check right before each write — if the text at a position no
   longer matches what the plan was built against, that edit is skipped and
   reported, never written blind.

They also check the active document's name against the one the plan (or
measurement) was built for, and refuse to write to the wrong document — an
optional `expectedDocName` lets you name the document you *mean*, as a
second check.

`pagination_apply` reimplements the same envelope independently, with
`expectedDocName` required rather than optional and `dryRun` defaulting to
`true`.

`indesign_run_jsx` skips almost all of the above — a deliberate choice. It
runs arbitrary ExtendScript in the live document: no backup, no
document-name check, no text check. It does wrap each call in one undo step
by default, but that's the tool's own baseline, not a safety net checked
against a plan — a script spanning several `indesign_run_jsx` calls is not
one atomic undo the way a `corrections_apply` batch is. This is for one-off
scripting tasks not yet covered by a dedicated tool; treat every call to it
like running a script by hand in InDesign, and save the document first.

Three more facts, measured on live InDesign, worth knowing before you rely
on the safeguards above:

- **A locked layer does NOT protect the document from this tool.** Setting
  `layers[0].locked = true` and then writing to text on that layer succeeds
  without an exception — locking a layer does not stop scripted
  ExtendScript writes. A locked **frame** (`frame.locked === true`) doesn't
  protect its text either, on either side of the interaction, even though
  the lock is real: `geometricBounds` and `remove()` on that same frame
  throw `Object is locked.` — InDesign protects the page item, not its
  text. `pagination_apply` refuses to write in both cases, but that's its
  own policy, not an InDesign restriction, and it doesn't extend to the
  other tools.
- **`_backups/` rotates automatically, but only the tool's own copies.**
  Each `corrections_apply` call that applied at least one edit creates a new
  backup file, then keeps the 10 most recent and deletes older ones matching
  its exact naming pattern
  (`<base>_do-pravok_YYYY-MM-DD-HHMM[-N].indd`). A file under the same
  prefix but named by hand never matches that pattern and is never deleted.
  If rotation itself fails (the file is locked by cloud sync or another
  process), the edits are still applied — the report's `backupRotationError`
  field says so rather than failing silently.
- **The document must already be saved to disk before edits are applied.**
  There's nothing to back up otherwise, and the tool refuses to write.

Full detail — including the parallel envelope `pagination_apply` reimplements
for itself — is in [`docs/reference.md`](docs/reference.md).

## 🐛 Troubleshooting

**"Adobe InDesign is not running."** The tools drive a live application; there
is no file-parsing fallback. Launch InDesign 2026 and open a document.

**The first call hangs, then fails.** macOS is asking for permission to control
InDesign and the dialog is behind another window. If it was denied earlier:
System Settings → Privacy & Security → Automation.

**A call fails with a syntax error mentioning `script`.** InDesign was busy —
a modal dialog, a long recompose, another script. AppleScript's terminology
for the application becomes unavailable while it is blocked, and the next call
fails on the word rather than on the work. Clear the dialog, wait for the
document to settle, call again.

**A tool reports a document you are not looking at.** InDesign's notion of the
active document belongs to the *window*, not to the application. Bring the
window you mean to the front, or pass `expectedDocName` — the write tools
refuse to touch a document whose name does not match.

**A write tool refuses: the document is not saved.** There is nothing to back
up, so it will not proceed. Save the document to disk first.

**Changes to an anchored frame's geometry disappear.** They are reverted by the
next recompose. This is InDesign's behaviour, not the tool's; measured, and
recorded in `docs/measured-facts-*.md`.

**A tool returns defaults instead of an error after you passed a parameter.**
Check the parameter's name against the tool's own schema — an unknown key is
dropped silently, and on a tool whose default is "scan everything" that looks
like a successful whole-document run.

**Edits land in a different codebase than you expect.** An MCP server started
from another checkout serves *that* checkout's code. Check which path your
client launched.

**The integration suite fails without InDesign.** It needs a running
application by design; `npm test` is the suite that does not.

## 🧑‍💻 Development

```bash
npm test                   # unit + web only — no InDesign needed
npm run test:integration   # needs InDesign running
npm run typecheck
npm run test:all           # all three, in order — the only complete gate
```

**"The tests are green" has to say WHICH tests.** `npm test` is
`--project unit`; it does not run the integration project, and
it cannot, because that project needs a live InDesign. This is not a
footnote: two integration assertions on a response's byte size drifted and
stayed red for two days behind a truthful-sounding "2913 tests green",
because the number came from a run that never included them. Use
`npm run test:all` before claiming a clean tree, and name the scope whenever
you cannot.

Both test scripts are scoped by Vitest `--project` (`unit` / `integration`),
not a positional path — `npm run test:integration -- tests/integration/x.test.ts`
alone runs the whole integration suite, not one file. Scope it with
`--project`:

```bash
npm run test:integration -- tests/integration/bridge.test.ts
```

Files under `src/jsx/` are ExtendScript ES3 (`var`, `function`, plain loops
only). All matching and parsing logic lives in TypeScript so it can be
tested without InDesign.

## 🤝 Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it has four rules that are
not style preferences: measure rather than reason from the scripting
reference; a check must be able to fail; `src/jsx/` is ExtendScript ES3; and no
book's data ever enters this repository.

Security reports go through [`SECURITY.md`](SECURITY.md), not a public issue.

## 🧭 Related projects

[`lucdesign/indesign-mcp-server`](https://github.com/lucdesign/indesign-mcp-server)
is another MCP server for InDesign, with a broader set of authoring tools —
creating documents, placing and styling content. If that is what you need, look
there first; the names are close enough to be worth telling apart.

This one is built around a different job: **auditing a finished layout before
it goes to print**, in a way that is honest about its own coverage. Hence the
prepress families (ink coverage, rich black, resolution, bleed, links), the
bibliographic and orthographic rules, the three typographic schools with a
language gate between them, and the coverage field on every audit response.

## 📝 License

MIT — see [`LICENSE`](LICENSE).

One file is not MIT: `tests/fixtures/hunspell-oracle.json` is derived from the
Hunspell dictionaries InDesign ships, so it carries their terms — uk_UA
tri-licensed (we take MPL-1.1), en_US under a permissive grant that names
generated output explicitly, en_GB copyleft. It is test data, it is not in the
npm package, and nothing in `dist/` derives from it. The three licence texts
are vendored in [`licenses/`](licenses/); the reasoning is in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Also here: [`CHANGELOG.md`](CHANGELOG.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md).

## 🙏 Acknowledgments

- Spell checking leans on the dictionaries InDesign ships — the Ukrainian one
  from the [spell-uk](http://ispell-uk.sourceforge.net/) project, the English
  ones from [SCOWL](http://wordlist.sourceforge.net). They are read from your
  own installation and not redistributed here; the test oracle derived from
  them carries their licences, see
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- The bibliographic rules follow **ДСТУ ГОСТ 7.1:2006** and **ДСТУ 8302:2015** —
  the Ukrainian national standards for bibliographic description, issued by
  ДП «УкрНДНЦ». They are not an international norm and have no ISO
  equivalent that a publisher outside Ukraine would be held to.
- Built on the [Model Context Protocol](https://modelcontextprotocol.io).
