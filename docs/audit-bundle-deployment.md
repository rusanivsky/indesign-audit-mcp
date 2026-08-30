# Single-file audit: what to deploy and what packaging doesn't remove

```
npm run build:audit          # builds dist/indesign-audit.mjs
```

You need to deploy **one file** — `dist/indesign-audit.mjs` — plus a **config**
for the edition. Nothing else: no `node_modules`, no `npm install`, no network.

```
node indesign-audit.mjs --config my-book.json --out report.html
```

Next to the report lands `report.html.measurements.json` — the raw
measurements.

## What's inside

`zod` and the entire audit codebase are bundled by esbuild. Along with them,
two assets that used to be read from disk are bundled too:

- **17 JSX fragments** — the bridge stitches them together and sends them to
  InDesign;
- the **report template** `report.html`.

The JSX loading order stays the same and remains the single source of truth
(`jsxModules()` in `src/bridge/runner.ts`): the bundled module still travels
through a file in the temp folder, so `$.evalFile` still gives a line number
within its own module.

The only external things left in the bundle are Node's built-in modules
(`node:fs`, `node:path`, `node:child_process`, `node:os`, `node:url`,
`node:util`). There are no native dependencies — that's exactly why bundling
is possible at all.

## Limits. Measured, not assumed

**macOS only.** The bridge talks to InDesign via `osascript`
(`src/bridge/runner.ts:135`, `:207`). There is no Windows path — not
"untested," but no code for it.

**InDesign must be installed and RUNNING.** The CLI drives a live
application; a `.indd` file is not parsed on its own. The document must be
open.

**A localized InDesign build will give silent zeros.**
`src/spelling/dictpath.ts:42-44` matches against **English** language names:
`["Ukrainian", "uk_UA"]`, `["English: USA", "en_US"]`, `["English: UK",
"en_GB"]`. If InDesign reports a name differently, the language gate returns
zero **silently**. That's exactly why the environment fingerprint in the
report is mandatory (spec §6.2): it's the only way to notice that a run on
another machine measured something different.

**No need to ship the dictionaries** — the path is derived from the
installation path.

**A new document needs its own config.** This isn't a flaw, it's a
deliberately transferred cost (spec §11): whatever the document can't tell
you about itself, a person has to name. The practical approach is to declare
almost everything as `{"notApplicable": "…"}` and bring families up one at a
time. Validation tier 1 refuses before InDesign is even touched; tier 2 does
so if the named style doesn't exist in the document.

## Exit codes

| code | meaning |
|---|---|
| 0 | clean |
| 1 | there are critical findings **or** a critical family wasn't measured at all (R46) |
| 2 | config rejected (tier 1 or tier 2) |
| 3 | environment failure: InDesign not running, wrong document, active document didn't switch (R41) |

Code `1` also fires when a critical pass **crashed, has no adapter, or
returned empty data**. Previously such a run returned `0` — "ready to
print." If you're used to the old behavior, this is the change to know
about.

## A trap already caught on this bundle

The entry point used to run under the condition `argv[1].endsWith("audit.js")`.
The bundle is named differently — so the audit **never ran at all**, and the
process exited with code `0`. That is, "check passed, go to print," with no
check having actually happened.

Now the guard compares the `realpath` of the entry point against the
`realpath` of the module itself (`isProgramEntry`), and this is covered by
tests. If you ever rename the bundle, it will keep working.
