# Measured facts — `preflight_document`

Date: 2026-08-07. Run through the built branch (`npm run build`, then `runJsx`
against `dist/`), **not** through `mcp__indesign__*`: the MCP server was
launched from the main checkout and would have silently served the stale
build.

Book document: **`Book 260807-0100.indd`, 196 pages** — read-only. All
mutating probes ran against **our own temporary documents**, which the probe
itself creates and closes (`app.documents.add()` → `doc.close(SaveOptions.NO)`);
`app.documents.length` and `app.preflightProcesses.length` were checked after
every run.

These facts were gathered during a review and a round of fixes. Before this
they lived only in commit text — i.e. they were unreachable for the next
phase.

---

## Trap 1: `itemByName` doesn't see names in square brackets

`app.preflightProfiles.itemByName("[Basic]")` returns an **invalid object**:
`isValid === false`. The profile can only be found by iterating
`app.preflightProfiles[i].name`.

**This applies to EVERY book and every phase** — the same family as
`RUNNING_HEADER_PARAGRAPH_STYLE_TYPE` in Phase 6: looks obvious, silently
doesn't work. Names in square brackets are internal to InDesign (`[Basic]`,
`[Basic Paragraph]`, `[No Paragraph Style]`, `[None]`), so the trap waits
wherever an internal object is looked up by name.

---

## Trap 2: `waitForProcess`'s polarity is the REVERSE of its name

Control on the **same** process — three calls in a row:

| call | returned | `aggregatedResults` | `processResults` |
|---|---|---|---|
| `waitForProcess(0)` | **`true`** | **THROWS** "Aggregated Result for this process is not available" | `"No errors yet; still looking."` |
| `waitForProcess(60)` | **`false`** | available, complete | `"Errors Found (1): Text Frame (R=2)"` |
| `waitForProcess(60)` | `false` | available (stable) | same |

So **`true` means "did NOT finish waiting"**. The check `if (!waited) throw`,
which the method's name invites, would fail **every successful run**.

Without this control the review would have been carried out literally and
would have broken the tool.

**The polarity travels back through the `waitTimedOut` field, and it can
genuinely be `true`.** The first draft of the fix threw on
`waitTimedOut !== false` BEFORE the result object was built — meaning in the
report that was actually emitted, the field could physically only ever be
`false`, and the claim "the polarity flip will be visible in the report" was
false: it would only ever have been visible as a crash. The throw has since
been removed (see "Three signals" below), and `waitTimedOut: true` is now a
legitimate, reportable state.

---

## Trap 3: `proc.status` DOES NOT EXIST

`proc.reflect.properties` for a `PreflightProcess` gives exactly:

```
targetObject, appliedProfile, description, processResults,
processInventory, aggregatedResults, isValid, parent, index
```

methods: `remove`, `waitForProcess`, `saveReport`.

Accessing `proc.status` throws immediately: `Object does not support the
property or method 'status'`. So advice to "read `proc.status`" is
unactionable, and what actually works instead is the pair of "the returned
value + an attempt to read `aggregatedResults`."

---

## Trap 4: an unfinished process THROWS instead of returning empty

`aggregatedResults` on a still-running process doesn't return an empty
array — it throws `Aggregated Result for this process is not available`. The
raw **timeout message says nothing**, so the tool translates it into an
explanation: how long it waited, what the wait call returned, and why there
is no report.

---

## Three signals: what they actually cover, and what they don't

The tool has three completeness checks, and **they are not equivalent**:

| | signal 1 | signal 2 | signal 3 |
|---|---|---|---|
| what it looks at | whether `aggregatedResults` could be read | what `waitForProcess` returned | the TYPE of what it returned |
| when it fires | there IS NO result → **throws** | there IS a result, but the wait says "didn't finish" → **the report is returned with `waitTimedOut: true`** | the returned value is outside `{true, false}` → **the report is still returned**, `waitTimedOut` is set to `true` CONSERVATIVELY, and the raw value's type goes into `waitPolarity` |
| reachable on live InDesign | **always** | **never** | **never** (on the measured version 21.4.1.4) |

**Signal 3 didn't appear all at once, and it didn't disappear all at once
either.** The first draft threw on `waitTimedOut !== false`, i.e. it caught a
non-polar value **incidentally**. When signal 2 was deliberately changed to
stop throwing, that check disappeared along with it, and nothing broke —
because the state is unreachable.

**The mechanism behind its silence was measured, because the first
explanation was wrong.** The claim "`undefined` disappears from JSON, so the
field is absent from the report" is **false**: the report is not serialized
by `JSON.stringify` but by a custom `IDMCP.stringify` (`src/jsx/_core.jsx:27-31`),
which renders `undefined`, `null`, **and** `NaN` identically as `"null"`. So
the field IS present — as `null` inside a field declared `boolean` — and
`buildCaveat` checks it by **truthiness**. `null` is falsy, so no loud line
gets printed: the report would look like "finished waiting, complete list."

```
IDMCP.stringify({waitTimedOut: undefined})  ->  {"waitTimedOut":null}
IDMCP.stringify({waitTimedOut: null})       ->  {"waitTimedOut":null}
IDMCP.stringify({waitTimedOut: NaN})        ->  {"waitTimedOut":null}
```

**Why signal 3 degrades gracefully instead of throwing** — for the same
reason as signal 2, and here the reason is even stronger: the reported
strings are read from `aggregatedResults` and **don't depend on
`waitForProcess` at all**. A non-polar value only makes the list's
**completeness** unknown. Throwing would introduce an even worse failure
mode down the line: if Adobe ever changes the return type, every run of the
tool would die instead of returning real findings.

**Why `waitPolarity` carries `typeof` rather than the value itself:**
`String("true")` and `String(new Boolean(true))` both produce `"true"`.
Without the type, the field would say nothing about the cause.

**Signal 2 is unreachable in a real run, because signal 1 fires first.** The
InDesign version measured either finishes (`false` + the result is readable)
or doesn't (`true` + reading throws) — it never produces the state "didn't
finish waiting, but the result exists." So signal 2 exists as a **second line
of defense in case InDesign ever starts returning partial results instead of
throwing**. This should be said out loud: an integration test that
"reproduces the timeout" actually only proves signal 1.

Signal 2's behavior was verified **by execution, but against a stand-in
`app`**: `tests/unit/preflight-jsx-logic.test.ts` runs the real
`preflight.jsx` inside Node (precedent: `jsx-apply-logic.test.ts`) and feeds
it a state that live InDesign never produces.

**Why signal 2 doesn't throw.** Preflight findings are **individually
true** — each one is a real violation in the document. A timeout only puts
the list's **completeness** in doubt, not the truthfulness of what's in it.
Telling apart "correct but incomplete" from "complete" is exactly what this
tool already does with "0 violations across 6 of 38 rules," so here too it
says it out loud: `waitTimedOut: true` plus the loudest, first `caveat`
block.

**Both facts come from the SAME measurement session.** The two signals'
mechanisms are independent, but the source of observation is shared: both
`waitForProcess`'s polarity and "an unfinished process throws on read" were
captured in one run on 2026-08-07. The second fact is no less load-bearing
than the first — signal 1, the one check that actually works, rests on it.
Future readers **should not treat this as double coverage**: if that session
was atypical in some way, both conclusions are wrong together.

---

## The shape of `aggregatedResults`

This is a **TREE FLATTENED INTO A LIST**: the first column of each row is
the depth (1 category, 2 rule, 3 instance).

A document with a deliberate overset:

```
["Untitled-266", "[Basic]", [
  [1, "TEXT (1)",         "",  "",                   []],
  [2, "Overset text (1)", "",  "",                   []],
  [3, "Text Frame",       "1", "Problem: Overset text: 94 characters\nFix: Resize the text frame, or edit the text to fit within the frame. Add text frames to the story thread if necessary.",
      [["Problem", "Overset text: 94 characters"], ["Fix", "Resize the text frame, …"]]]
]]
```

**A clean document** — the same shape, with an empty row list:

```
["Untitled-268", "[Basic]", []]
```

Two conclusions follow from this, and they shaped the implementation:

- the shape **isn't visible on a clean document**, so the integration test
  needs its own fixture with a deliberate overset (`__fixture_make_preflight`)
  — otherwise the measurement of the shape would stay unreplicated;
- "shape recognized" and "rows present" are **different states**, so
  `shapeRecognised` is kept separate from `rowsSeen`.

The fourth column (description) is `key: value` pairs joined with `\n`.
Because of that, it isn't duplicated in the response when the pairs
reconstruct it exactly, and is carried verbatim when they don't (in
particular, when there are no pairs at all).

---

## The `[Basic]` profile's makeup: 38 / 6 / 32

Direct iteration over `profile.preflightProfileRules`:

| total rules | enabled | disabled |
|---:|---:|---:|
| **38** | **6** | **32** |

Enabled: `ADBE_InaccessibleUrlLinks`, `ADBE_MathExprPlaceHolders`,
`ADBE_MissingFonts`, `ADBE_MissingModifiedGraphics`, `ADBE_OversetText`,
`ADBE_UnresolvedCaption`.

Among the disabled ones — **`ADBE_ImageResolution`**: low image resolution
is **not checked at all** by default. This is exactly why the tool can't get
away with reporting bare error counts: "0 violations" would be a formally
correct and practically harmful answer.

**These 38 entries are not in the unit tests.** The first draft of the tests
had a comment "Measured `[Basic]` makeup: 38 rules" over an array of nine —
in a project where a comment is supposed to equal a measurement, that's
misleading. The comment now honestly labels it a SLICE, and the numbers
38/6/32 are verified against the live profile in the integration test.

---

## Response size, and where the cap came from

The review measured `ok()`'s serialization against the response shape **as
it then stood**:

| instances | bytes |
|---:|---:|
| 0 | 1,243 |
| 50 | 21,856 |
| 200 | **83,751** |
| 1000 | 413,700 |
| 3000 | 1,238,580 |

Cost per instance: (83,751 − 21,856) / 150 = **412.6 B**. The threshold that
Phase 4 had already once knocked the tool out with is **78 KB**; it's
crossed at around ~190 instances. Getting there is possible **just by
following the caveat's own advice**: enable `ADBE_ImageResolution` on a book
with hundreds of images. In other words, without a cap the tool's own advice
would break the tool.

The response shape has since grown (`description`, `occurrenceCount`, gauge
counters), so the number was **re-measured against that shape**, with real
Problem/Fix text from InDesign:

| instances | bytes |
|---:|---:|
| 0 | 2,681 |
| 50 | 26,497 |
| 80 (cap) | **40,837** |
| 580 | 40,877 |
| 3000 | 40,883 |

Cost per instance here, (48,485 − 2,681) / 96 = **477.1 B** — pricier than
412.6 B, and it's the pricier one that's used. The target is 40 KB
(40,960 B), half of 78 KB: (40,960 − 2,681) / 477.1 = 80.2 →
**`MAX_PREFLIGHT_OCCURRENCES = 80`**.

The last three rows of the table are proof the cap holds: between 80 and
3000 instances the response grows by 46 B (that's `occurrencesTruncated`),
not by a factor of 37.

**The number needs to be GUARDED, not just recorded.** The first draft of
the cap test built instances with an empty description and no pairs — 128 B
instead of 477 B. A measurement against a copy of the tree: the cap could be
raised to 200, even 300, and stay green (it only failed at 320), while 300
instances of real text weigh ≈139 KB — nearly double Phase 4's 78 KB. In
other words the threshold wasn't actually being enforced, guarded or not —
exactly the kind of vacuous test Phase 5 caught twice.

The test now builds instances with real Problem/Fix text, and this has been
proven by execution: with the cap at **120, 200, and 320** it fails.

---

## Run against the working book

`Book 260807-0100.indd`, 196 pages, through the built branch:

| what | value |
|---|---|
| run time | **373 ms** |
| response size | **2,449 B** |
| rules enabled / disabled | 6 / 32 (of 38) |
| violations | 0 |
| `shapeRecognised` | `true` |
| `rowsSeen` / `rowsParsed` | 0 / 0 |
| `processRemoved` | `true` |
| `waitTimedOut` | `false` |

Safety was verified with a separate call BEFORE and AFTER: `doc.modified`
`false` → `false`, `saved` `true` → `true`, one open document,
`app.preflightProcesses` 1 → 1 (ours removed), the document's working
profile stayed `[Basic]`.

**"0 violations" only reads correctly together with "6 of 38 rules."** This
is the same answer the tool would present as "all clean" if it had no
caveat.
