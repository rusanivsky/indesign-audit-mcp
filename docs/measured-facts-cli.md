# Measured facts: first live CLI run (Task 13)

First run of the built `dist/cli/audit.js` on the real book.
The goal is not "matches / doesn't match" but to measure and explain.
The regression **failed** (13 mismatches out of 14), and almost every
one of them has a concrete explanation found by reading the code — not
"the book is different."

## 1. Document state

**BEFORE the run** (`indesign_status`, twice: directly and through
`dist/cli/collect.js`, byte-identical):

```json
{ "version": "21.5.1.73", "documents": [], "activeDocument": null, "books": [] }
```

No document was open — the CLI had to take the `"open"` branch.

**AFTER the run** (`indesign_status`):

```json
{
  "version": "21.5.1.73",
  "documents": [{
    "name": "Book 260816-1250.indd",
    "saved": true,
    "modified": true,
    "fullName": "~/Library/CloudStorage/GoogleDrive-.../Book 260816-1250.indd",
    "pages": 196
  }],
  "activeDocument": "Book 260816-1250.indd"
}
```

The document **stayed open** — and that is measured, explained CLI
behaviour, not a failure. `EnvironmentStamp.releaseSkippedReason` in the
measurements file:

> «шлях документа відрізняється від очікуваного — це вже не той
> документ, який ми відкривали»
> ("the document path differs from the expected one — this is no longer
> the document we opened")

**The disk was NOT changed.** `save`/`SaveOptions.YES` was never called —
verified by reading `session.ts` (the only close call is
`SaveOptions.NO`) and by the fact that the document is still open right
now (the close never happened at all).

### Why the release refused to close — a finding, not a mystery

`session.ts` (release) checks THREE conditions before closing, in ONE
JSX expression, and stops on whichever one fires with the SAME "path
differs" message — even if a DIFFERENT condition is the one that
actually fired:

```js
if (!__d.isValid) { ... }
else if (!__d.saved || String(__d.fullName) !== docPath) {
  __result = {closed:false, reason:"шлях документа відрізняється..."};
} else if (__d.modified) { ... }
```

Measured: the document got `modified: true` IMMEDIATELY after
`app.open()` — before even the first audit pass (first stderr line:
"opened by us, has UNSAVED edits"). None of our (read-only) passes write
to the document. It is InDesign ITSELF that marks the document modified
on open (most likely: a file-version mismatch, link relinking, or some
other internal normalisation), and that is exactly why `!__d.saved` is
already true at close time, independent of the path.

Separately, the path genuinely does NOT match: `indesign_status`
returns `fullName` as a `~/...` string with `%XX` escaping (a
URI-like string), while `docPath` in the config is a plain POSIX path
with Cyrillic in it. `String(__d.fullName) !== docPath` is therefore
TRUE in practice on essentially any non-ASCII or home-directory path,
regardless of `modified`. Both causes can fire at once; the message
only shows the SECOND one (path), even though the FIRST one
(`!saved`) may have fired too. This is not a safety issue (the document
stays closed either way in BOTH cases), but it makes
`releaseSkippedReason` a less precise diagnostic than it could be.

**Consequence for the operator:** the book's document is currently open
in InDesign, WITHOUT any changes saved to disk. Closing it by hand
(File → Close, Don't Save) is safe at any time.

## 2. Timing

The InDesign session had NOT just restarted: `sessionUptimeMs =
269 020 166` ms ≈ **74.7 hours**. Per the REFERENCE memory on InDesign,
this can bloat heavy passes several times over — keep that in mind
while reading the numbers below.

Total CLI run time: **≈ 87 seconds** (20:03:21–20:04:48, OS clock),
which is radically shorter than the 10–20 minutes expected in the
brief. The reason is NOT speed, but that the TWO most expensive passes
by budget (`layout` — 420,000 ms limit, `composition` — 600,000 ms)
failed early, without completing a full measurement.

| pass | tool | ok | elapsedMs |
|---|---|---|---:|
| status | indesign_status | ✓ | 358 |
| overview | doc_overview | ✓ | 642 |
| preflight | preflight_document | ✓ | 392 |
| color | color_audit | ✓ | 5 818 |
| geometry | geometry_audit | ✓ | 1 096 |
| typography | typography_audit | ✓ | 2 271 |
| **styles** | styles_audit | ✗ | 10 786 |
| pagination | pagination_audit | ✓ | 1 229 |
| **sequences** | pagination_audit | ✗ | 0 |
| spelling | spelling_audit | ✓ | 2 805 |
| **layout** | layout_audit | ✗ | 31 303 |
| **composition** | composition_audit | ✗ | 362 |
| extras | __cli_extras | ✓ | 21 752 |

The sum of all `elapsedMs` is 78,814 ms; the rest (~8 s) is opening the
document, `doc_overview` for stage-2 validation, the close attempt, and
writing the report.

**`styles` and `layout` did NOT fail instantly** — 10.8 s and 31.3 s of
real InDesign measurement went nowhere: both failed NOT during the
measurement, but in the JS code that processes an already-obtained
result (see §4). `composition` failed after 362 ms — before touching
InDesign at all (the `pageWindows()` check is a pure JS function that
fires right at entry). `sequences` — 0 ms, also pure input validation.

## 3. Regression — "expected / actual / explanation" table

```
node scripts/regression-book.mjs /tmp/m.json
РЕГРЕСІЯ: ВПАЛА — розбіжностей 13.
код виходу регресії: 1
```
("REGRESSION: FAILED — 13 mismatches." / "regression exit code: 1")

| key | expected | actual | explanation |
|---|---:|---:|---|
| `pages` | 196 | **196** | MATCH. `doc_overview.pageCount`. |
| `linksNormal` | 6 | not found | The value **matches in substance** (6): `doc_overview.links` — 6 links, all `status: "NORMAL"`. There is no field LITERALLY named `linksNormal` anywhere in the API — the plan invented the field name, the value is genuine. |
| `inks` | 4 | not found | The value **matches**: `color_audit.inkCount === 4` (`inkNames`: Cyan/Magenta/Yellow/Black). The field is called `inkCount`, not `inks`. |
| `maxTac` | 240 | not found | Likely **consistent**: `color_audit.tacSurvey` — the bucket `{upTo:240, count:885}` is the last NON-ZERO one (all buckets 260–320 have `count:0`), meaning the measured maximum total ink coverage in the book rounds to the 240 boundary. The API gives no single "maximum" scalar — only a distribution across buckets; there is no literal `maxTac` field. |
| `overset` | 0 | not found | The value **is consistent** (0): `preflight_document.findings === []`, `occurrenceCount === 0`. But "overset" is not a measurement field — it is a FUNCTION in `audit.ts` (`overset()`), computed only during HTML rendering and never written to `measurements.json` — by construction there is no such key to look for there. |
| `folios` | 131 | not found | **A likely GENUINE mismatch, root cause found** — see §4.1. `pagination.folio` = `{checked:0, deviating:169, groups:[{defect:"folio-helper-chain-gap", count:169}]}`. Neither 0 nor 169 equals 131. |
| `runningHeads` | 50 | not found | **The same root cause** (§4.1). `pagination.runningHead` = `{checked:0, deviating:0, groups:[]}` — ZERO assertions examined, even though Phase 10 measured "50 running-head assertions, 50 from the master" on this same book in a live run earlier. |
| `contentsNumbers` | 35 | not found | Not a book mismatch: the config (per the brief's own template, Step 1) did **not query** the `contents` family AT ALL — `pagination.contents === null`. To measure it, the config needs to carry `contents: {numberStyle, levelMap}`, which the brief's example does not include. |
| `questionNumbers` | 185 | not found | Failure of the `sequences` pass — anticipated by the brief itself (R6). `pagination_audit` has no concept of `rules`; it received `{rules:[...]}` and threw "no family declared". Root cause in §4.2. |
| `words` | 31 412 | **2** | **The value actually MATCHES** — `spelling_audit.languages[0].words === 31412` exactly. `regression-book.mjs`'s lookup finds it in the WRONG place: the traversal walks `m.passes` in execution order, and `doc_overview` (which runs BEFORE `spelling_audit`) has its own `words` field in EVERY story (`overview.stories[0].words === 2`) — the first match in the DFS walk wins. This is a flaw in the script's naive first-match strategy (taken verbatim from the brief — not changed here), not a flaw in the measurements. |
| `unknownWordTypes` | 497 | not found | **The value MATCHES exactly**: `spelling_audit.wordTypesTotal === 497`. The field `unknownWordTypes` NEVER exists in the API — and this is documented right in the CLI's own code (`src/cli/report/sections.ts`, a comment in plain text: "`SpellingReport` has no `unknownWordTypes` field — Task 11's plan invented it"). Task 13's regression inherited the same invented name from the spec. |
| `emptyParagraphs` | 398 | **416** | Two DIFFERENT implementations of empty-paragraph counting give different numbers. `composition_audit` (where the number 398 was supposed to live) **did not run at all** (`pageWindow` not supplied, §4.3). The 416 found comes from a SEPARATE, parallel implementation, `__cli_extras` (`src/cli/measure/extras.ts`), which counts by DIFFERENT logic/coverage (possibly including master pages or the pasteboard — not checked in detail within this task). This is a REAL, unresolved mismatch worth its own investigation. |
| `forcedBreaksTotal` | 401 | not found | `__cli_extras.forcedBreaks.total === 402` — **1 more** than expected. The field is real, the name is different (`forcedBreaks.total`, not `forcedBreaksTotal`). Whether the difference of 1 is book drift (per the Phase 12–13 precedent, the book had already changed BETWEEN the measurement and the same-day run) or a rounding boundary in the other implementation — not established. |
| `forcedBreaksInBody` | 27 | not found | `__cli_extras.forcedBreaks.inBodyText === 7` — **substantially different** from the expected 27 (not a one-off drift). The field is real, the name is different. The nature of the mismatch needs a separate investigation — out of scope for this task. |

**Summary of the nature of the 13 mismatches:**
- **6 — fictitious field names in EXPECTED, the values actually MATCH**: `linksNormal`, `inks`, `overset`, `unknownWordTypes` (exact numeric match), and likely `maxTac` (qualitative bucket match).
- **1 — a flaw in the regression script itself** (naive first-match on `words`), the value also matches.
- **1 — deliberately not queried** (`contentsNumbers`, the brief's config does not include `contents`).
- **1 — a failure anticipated by the brief** (`questionNumbers`/`sequences`, R6).
- **2 — a NEW root cause found by this run**: a mismatch between the config's shape and `pagination_audit`'s real schema (`folios`, `runningHeads` — §4.1).
- **2 — real numeric mismatches without a final explanation**: `emptyParagraphs` (416 vs. 398, two different implementations) and `forcedBreaksInBody` (7 vs. 27, substantial).

## 4. Three root-cause-distinct reasons passes failed (new findings)

### 4.1. `pagination`: the `folio`/`runningHead` shape in the config did NOT match the tool's schema

> **Status: what was measured no longer reproduces — fixed by two
> changes after this run.** The description below is left as-is: it
> explains where the numbers in §3 came from, and it cannot be erased
> without also erasing the reason for those numbers. What changed is
> covered at the end of the section, under "What replaced it."

`configs/example-book.json` (per the brief's template) supplied:
```json
"folio": "Колонтитул v1",
"runningHead": ["Колонтитул v1", "Колонтитул v2"]
```

The real `pagination_audit` schema (`src/tools/pagination.ts:90-97,
630-639`) requires WRAPPED objects:
```ts
folio: z.object({ styleName: z.string() }).optional()
runningHead: z.object({ styleNames: z.array(z.string()).min(1) }).optional()
```

> **STALE IN SHAPE, STILL TRUE IN SUBSTANCE (edit 2026-08-18).** Commit
> `fc8f96d` (2026-08-17) lifted the "one folio style" limit: `folio` is
> now `{ styleNames: z.array(z.string()).min(1) }`, same as
> `runningHead`. The робочої книжки spread is set in TWO styles, and the
> singular form made the family unmeasurable on half the book.
>
> Every mention of `styleName` (singular) BELOW IN THIS SECTION is
> **history**: that is how things stood at the time of the 2026-08-16
> measurement, and that is exactly why they are not rewritten. The
> measurement itself did not go stale because of the rename: it is
> about the fact that the WRONG SHAPE does not yield zero findings — it
> yields an unmeasured family — and that holds true regardless of the
> field's name. The rule that grew out of it now sits in the code as
> two gates: `IDMCP.rejectUnknownParams` (`src/jsx/pagination.jsx`)
> refuses on an unknown KEY, and `folio.styleNames` is checked right
> inside the `pagination_apply` handler, because the schema does not
> always fire on that path.

`plan.ts`'s `аргументи()` (`arguments()`) for the `pagination` family
has no special case — it falls into `default: return {...решта}`
("...the rest") and passes the config through LITERALLY, without
repacking its shape. In the handler itself (`pagination.ts:655,659`),
the typing is a mere `as`-cast, with no runtime shape check:

```ts
const folioArg = args.folio as { styleName: string } | undefined;
const headArg = args.runningHead as { styleNames: string[] } | undefined;
```

Since `args.folio` is a STRING (truthy), `folioArg !== undefined` is
true, so the pass does NOT fail with an error. But `folioArg?.styleName`
on a string is `undefined`, so the measurement gets `folioStyle: null`
(`pagination.ts:691`) — no folio number is tied to any style, only the
structural chain defect is counted (`folio-helper-chain-gap`, 169 — one
per frame on the service layer, regardless of style).

Likewise `args.runningHead` is an ARRAY (truthy), `headArg?.styleNames`
on an array is `undefined` → `runningHeadStyles: []` (empty) →
`detectHeads` sees NO running-head frame at all — `checked: 0,
deviating: 0, groups: []`.

**This explains BOTH `folios`/`runningHeads` mismatches with one root
cause: the config should have carried `"folio": {"styleName":
"Колонтитул v1"}` and `"runningHead": {"styleNames": ["Колонтитул v1",
"Колонтитул v2"]}`.** Not fixed within that task on purpose — the brief
forbade "fixing the config at will"; the config shape in `maaam.json`
was left AS GIVEN by the brief, and the mismatch is documented here.

#### What replaced it

The silent degradation ("169 phantom chain defects, zero running
heads, no error at all") no longer reproduces — it was cured from two
independent directions:

1. **Argument parsing (commit `ce246af`, ruling R24).** `callTool`
   (`src/cli/collect.ts`) now runs arguments through the tool's
   `inputSchema` — the same step the MCP SDK performs
   (`mcp.js:166-180`). A string in place of `z.object({styleName})` no
   longer reaches the handler: parsing refuses LOUDLY, naming the tool
   and the field ("Tool «pagination_audit»: invalid arguments. folio —
   …"), and the pass goes into "Not seen" with a reason, instead of
   into the report with a number. So the same config is now enough to
   replace the silent 169 with a visible refusal.
2. **Config shape (commit `c4ab739`, task A).** `configs/example-book.json`
   now carries exactly the shape the schema requires:
   `"folio": {"styleName": "Колонтитул v1"}` and
   `"runningHead": {"styleNames": ["Колонтитул v1", "Колонтитул v2"]}`.
   So there is no refusal from point 1 on this config either — the
   family is measured as intended.

What remains true today: **`plan.ts`'s `аргументи()` still passes the
family's config through LITERALLY** (`default: return {...решта}`),
without repacking its shape. The field-name shape is owned by the
config schema, not by `plan.ts`; the one exception is the
`nearMissPt` → `nearMissThresholdPt` rename in the `geometry` family,
and it is explicitly commented there.

### 4.2. `sequences`: `pagination_audit` has no concept of `rules` (anticipated by the brief, R6)

`pagination_audit` only knows about the `folio`/`contents`/
`runningHead` families. `sequences` as a CLI family has no matching
`case` in `plan.ts`'s `аргументи()`, so `{rules: [...]}` is passed
through literally — the tool does not recognise it under any of its
three fields and refuses: "no family declared."

### 4.3. `styles`/`layout`/`composition`: zod defaults were NOT applied by this CLI

> **Status: what was measured no longer reproduces — fixed by commit
> `ce246af` (R24).** The description below is left as-is, for the same
> reason as §4.1. What changed is under "What replaced it."

`styles_audit` (`src/tools/styles.ts:249-252`) and `layout_audit`
(`src/tools/map.ts:133-136`) declare `families:
z.array(...).default([...])`; `composition_audit`
(`src/tools/composition.ts`) declares `pageWindow:
z.number().default(PAGE_WINDOW)`.

But `dist/cli/collect.js`'s `collectTools()` (`src/cli/collect.ts:47-56`)
captures the handlers DIRECTLY, bypassing the standard MCP SDK path
that would normally run `args` through `inputSchema.parse()` and fill
in the defaults. There is no `zod.parse()` here at all: the handler
receives `args` exactly as `plan.ts` assembled it from the config. For
families given an empty object (`"styles": {}`, `"layout": {}` — that
is exactly what our config does), `args.families === undefined` — and
the first `families.includes(...)` throws `Cannot read properties of
undefined (reading 'includes')`. Likewise `composition`'s `pageWindow`
stays `undefined`, and the tool's own check (`pageWindows()`) throws an
explicit error even BEFORE touching InDesign.

**This is a systemic finding, not a one-off**: ANY config family whose
tool relies on a zod default, while the config leaves it as an empty
object `{}` instead of an explicit parameter list, suffers the same
fate — either silent `undefined` or (here) an exception. `styles: {}`
and `layout: {}` in the brief's example config (Step 1) turned out to
be insufficient for exactly this reason.

#### What replaced it

The tool registry (`collectTools()`) now keeps `inputSchema` alongside
each handler, and `callTool` runs the arguments through it —
`z.object(inputSchema).safeParseAsync(args)`, i.e. exactly what the MCP
SDK does (`mcp.js:166-180`). `.default(...)` now fires: `styles: {}`
gets the full list of families, `layout: {}` gets
`["overrides","masters"]`, `composition` gets `pageWindow: 20`. The
three passes that used to fail no longer fail.

The price of this was a new question that did not exist before
`ce246af`: **numbers in the report stopped being guaranteed
human-chosen**. Spec §5.4 promises "a number in the report is always a
number a human chose," and before `ce246af` that promise was upheld
precisely by the pass failing. Ruling **R28** split the parameters
into two classes and closed the gap this way:

- **print thresholds** (`minPpi`, `maxTotalInk`, `expectedInks`)
  continue to be passed EXPLICITLY from the config
  (`src/cli/run/plan.ts`), and no default is allowed to fire for them —
  §5.4 applies exactly where it says it does: "no relying on a
  convention where the report is read by the print shop";
- **scope selectors** (`families`) and **algorithm windows**
  (`pageWindow`) are allowed to default — but not silently.
  `callToolTraced` (`src/cli/collect.ts`) records which keys the schema
  filled in, and hands them to the pass runner as `PassResult.defaulted`;
  the report (`describeParams`, `src/cli/report/sections.ts`) prints
  them in the "Clean" card under a separate caption, "tool default (no
  one chose these)."

  Measured on `configs/example-book.json`: of the twelve passes, four measure
  with at least one default — `typography` (`sampleSize: 10`), `styles`
  (`families`), `layout` (`families`, `includeMasters`), and
  `composition` (eleven fields, including `pageWindow: 20`). Before
  R28 these numbers would have stood in the report unmarked.

So **the systemic finding from this section stays true; only its price
changed**: a family given an empty `{}` no longer fails — it is
measured with defaults, and the report says so out loud.

## 5. Report sections — all four confirmed

`/tmp/audit.html` (57,672 bytes) was opened and read as text. All
expected sections are present:

- `id="crit"` — **Critical** (4 rows — all `color_audit` unnamed-color).
- `id="major"` — **Major** (3 rows — all `extras`/pasteboard).
- `id="prepress"` — **Before sending to print**: one honest row,
  "Checklist not loaded by this run" (deliberate — the
  `print-audit-report` skill lives outside the CLI).
- `id="print"` — **Questions for the print shop** (8 rows, with
  checkboxes).
- `class="clean"` — **Checked — clean** (3 cards: overview, preflight,
  spelling).
- Callout **"What the check did NOT see"** — 12 items: 5 built-in tool
  limits, `indesign_status` (numbers not parsed), 32 disabled rules in
  the preflight profile, FOUR failed passes (styles, sequences, layout,
  composition) with each one's VERBATIM error text, and the
  `bibliography` family (`notApplicable`).

The section counts the CLI printed to stderr (`Clean: 3 · Not seen: 12
· Needs eyes: 8`) match the actual HTML byte for byte.

## 6. 66 scaled frames and 193 pasteboard objects — NOT visible the way the brief assumed

- **Horizontal scale ≠ 100: actually 0, not 66.** The document had
  `modified: true` right after opening (see §1), but
  `horizontalScaleOffenders.length === 0` — meaning that ON DISK (not
  in the unsaved session) the scale was already fixed everywhere. The
  brief's hypothesis ("the unsaved scale edits are gone already, so
  disk will give 66") is **refuted by measurement**: disk gives 0. This
  is consistent with the Phase 12–13 precedent — the book had been
  "fixed" several times between the spec's measurement and the live
  run. The report reflects this honestly: `sections.clean` does NOT
  include scale (because it is not a separate pass, but part of
  `extras`), but the row "Horizontal paragraph scale: all 100%" is
  visible in the "Questions for the print shop" section (`print-6`).
- **Pasteboard objects: 192, not 193.** `pasteboardItems`:
  `_folio-helper` 169 + `Шар 1` ("Layer 1") 18 + `Нумерація`
  ("Numbering") 5 = **192**. All three are visible as SEPARATE rows in
  the "Major" section (`major-1..3`) with exact numbers. The
  off-by-one is the same phenomenon: the book is not static between
  measurements taken in different sessions.

## 7. Exit codes

- `node dist/cli/audit.js …` → **1** (`EXIT.CRITICAL`) — 4 critical
  `color_audit` findings (unnamed-color) are real, not a failure.
- `node scripts/regression-book.mjs /tmp/m.json` → **1** — 13
  mismatches, analysed in detail above.

## 8. What was not investigated within this task

- Why `emptyParagraphs` (`__cli_extras` vs. the expected number from
  `composition_audit`, which did not run) differs by 18 — needs a
  comparison of the two counting implementations. Flagged as a
  separate task for review (not fixed here).
- Why `forcedBreaks.inBodyText` (7 vs. the expected 27) differs
  substantially rather than by a one-off drift.
- Whether a config with the correct `folio`/`runningHead` shape (§4.1)
  would actually have given 131/50 — not checked with a repeat run
  ("fixing the config at will" was forbidden within this task).
