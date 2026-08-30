# Ecosystem recon — Phase 2 (H2)

> **AMENDMENT 2026-08-16 about block `G`.** The sections below discuss a
> technology choice for a panel inside InDesign (UXP vs CEP) as a Phase 5 open
> question. **Block `G` was CANCELLED 2026-08-13:** the spec and plan are
> written, there is no code, nothing is merged into `main`, the idea doesn't
> hold up because of four MEASURED limitations of CLI 2.1.226. Everything
> about UXP here remains valid as technology reconnaissance, but as a
> **task**, block `G` is closed — do not reopen or re-measure it (see
> `docs/ПРОДОВЖИТИ-ТУТ.md`).

Date: 2026-07-31. Method: Adobe's public documentation and open repositories (WebSearch/WebFetch),
no code execution. Adobe MCP servers were connected in this session but required authorization that
wasn't available — no tool from them was called; the "Adobe MCP" assessment below relies solely on
documentation, with no invented call results.

**Correction round 1 (2026-07-31):** a review checked the raw source texts against this note and
found two incorrect claims — IdExtenso's compatibility (actually stated up to InDesign 21.x /
2026, not "up to CC2019") and a false "sources agree" claim about nested quotes (in fact one source
says the opposite, the other is silent). Both spots are fixed below, marked "Fixed after review,"
with direct quotes instead of paraphrase. One fabricated quote about Adobe's stance on UXP was
removed. Attribution of UXP gaps was split into two separate sources instead of one mixed list.

**Correction round 2 (2026-07-31):** a second review checked the new quotes character by character —
IdExtenso, typography.org.ua, stravopys.com, and the Adobe Tech Blog all matched. One inaccuracy
remained: the point about event-loop priority in the previous round was still attributed to thread
7902, though it isn't there. The source is corrected below to the real one (the "UXP vs CEP" thread,
Anoop Valomkot's reply).

## UXP vs ExtendScript

**Decision:** for Phase 5 (block G, a panel inside InDesign) — build on UXP, not on
ExtendScript/CEP. The existing ExtendScript bridge (`src/bridge/runner.ts` + JSX modules) stays the
working engine for DOM operations and is called FROM the UXP panel via `app.doScript()`, not
rewritten.

**Rationale:**
- InDesign has supported UXP since version 18.5 (2023), UXP v8.0 since version 20.0; the 2026 line
  (21.x) supports it fully. **Fixed after review:** Adobe does NOT declare UXP a mandatory
  replacement for ExtendScript — Adobe's own blog post on launching UXP scripting in InDesign 18
  (Adobe Tech Blog, Vidya Nachiyar, 2022) says, in tone, literally the opposite: "UXP Scripting is
  an additional scripting feature… existing JavaScript (ExtendScript), AppleScript, VBScript will
  continue to work as-is" — this is an addition to the existing scripting methods, not their
  cancellation. The decision to build the new panel specifically on UXP here does not rest on an
  Adobe stance that "UXP is the one true path" (no such stance exists in the sources found), but on
  the practical points below: version compatibility with the live InDesign 2026 and the `fullAccess`
  permission to the file system.
- The panel can be loaded locally without signing and without publishing to Adobe Exchange: UXP
  Developer Tool → Developer Mode → Load. That's exactly the path an internal tool needs, not
  distribution.
- Adobe's documentation describes the DOM core (pages, text frames, styles) as "practically
  identical" to ExtendScript — the Scripting DOM API Docs for CC 2026 are generated from the same
  object tree.
- The real UXP gaps relative to ExtendScript are recorded across three separate sources —
  attribution is kept apart so verified findings from different places don't blur into one
  indistinguishable "sources say":
  - per the `what_does_not_work.md` file in the RolandDreger/indesign-uxp-scripting collection (read
    directly): `resolve()` doesn't work (raw specifier → object); in the panel's UI layer itself (a
    Chromium-like environment), `DOMParser`, `TextDecoder`, `structuredClone`, `matchMedia`, and part
    of CSS (`display: grid`, `float`, `aspect-ratio`) don't work;
  - per the Adobe Creative Cloud Developer forum thread "Which missing feature or API is blocking
    your UXP migration?" (7902): no legacy `UnitValue` (Omachi's post), no native E4X XML
    (Roland_Dreger's and medium_jon's posts), UXP file encoding is always UTF-8 (Omachi's post) —
    which blocks Tagged Text / Data Merge scenarios that rely on other encodings;
  - **fixed after the second review:** the point about event-loop priority was previously
    misattributed to that same thread 7902 — it isn't there (checked by re-reading). The real
    source is a different thread, `community.adobe.com`, "UXP vs CEP," a reply from Adobe employee
    Anoop Valomkot: "If this is the case and this code is executing inline within the plugin's
    business logic, they aren't executed on priority" — inline calls from UXP to the DOM API get no
    priority in the event loop, because the plugin shares time with InDesign and other plugins.
    Valomkot's recommendation is the same one already recorded below: move heavy DOM logic into a
    separate `.idjs` (without `async/await`) and call it via
    `app.doScript(idjsFile, id.ScriptLanguage.UXPSCRIPT, args)`, rather than doing it directly from
    the UXP script.
  - None of these gaps block our scenario (text edits, uniformity audits), because all the heavy
    lifting already goes through the ExtendScript bridge, not directly from the UI layer.
- **Key for the project's architecture:** a UXP plugin with `"fullAccess"` in its manifest gets a
  Node-style `fs` module that reads/writes a file at an arbitrary fixed path without a file picker
  (confirmed by the `file-operation` recipe in the official UXP documentation for InDesign, an
  example of writing directly to an absolute path). This means: the existing bridge protocol
  ("parameters into a temp JSON → JSX via `$.evalFile` → result into a temp JSON") can be called
  essentially unchanged FROM the UXP panel — it writes `params.json`, runs `app.doScript()` on the
  same JSX modules (`_core.jsx`, `apply.jsx`, …), reads `result.json`. The JSX doesn't need
  rewriting for UXP.

**Consequence for block G (Phase 5):** a UXP panel is the primary candidate for the in-InDesign
interface; the existing ExtendScript bridge stays unchanged and is called from it. Before starting
G, a separate probe (measured, not from documentation) should confirm: does `fullAccess` actually
give access to the system temp folder (the `os.tmpdir()` equivalent) on macOS without an extra
confirmation dialog every time — sources disagree on the OS-level sandbox details of UXP, and in
practice this could turn out to be more expensive than documented.

## Prior art

| Source | License | What it does | Decision |
|---|---|---|---|
| [IdExtenso](https://github.com/indiscripts/IdExtenso) (indiscripts / Marc Autret) | "99.99% opensource" (README; one library inside, `JsxBlindLib`, partly obfuscated) | An ExtendScript framework: its own JSON formatter for ES3 quirks, file logging, environment management (OS/InDesign version/locale). **Fixed after review:** the README literally says "The framework supports ExtendScript from version 3.92 to 4.x and InDesign from v.6.0 (CS4) to 21.x (2026)" — the stated compatibility directly includes our version (InDesign 2026, 21.x); this document's previous claim of "compatible up to CC2019" was wrong. | Don't adopt — but NOT for incompatibility (there isn't any, checked directly in the README). Reason: our own bridge (`src/bridge/runner.ts` + JSX modules) is already written and works on a live document; pulling in a full framework for ES3 compatibility we've already handled ourselves is an unnecessary dependency with no concrete problem it solves right now. Worth revisiting if we ever hit serialization trouble for specific DOM values via `JSON.stringify`, or need centralized file logging — then IdExtenso's own ES3-quirk-aware JSON formatter becomes a direct candidate, not just an idea with no application. |
| [SimpleIDML](https://github.com/Starou/SimpleIDML) (Starou, Python) | BSD | Offline manipulation of `.idml` (ZIP+XML): unpacking, composing documents from parts. In production at Le Figaro for classifieds. | Don't adopt. Task 1 measured: walking a LIVE document line-by-line via ExtendScript costs 2.2–4.0 s for the whole 217,493-character document — cheaper and more accurate than export → unpack IDML → parse XML → analyze. The approach is only useful as an idea for an "audit without InDesign open" scenario, which isn't needed right now. |
| [Indentz](https://github.com/pchiorean/Indentz) (pchiorean) | MIT | A collection of ExtendScript scripts: layers/swatches/fonts, guides, pagination, QR/barcodes. The author explicitly states a focus on single-page layouts. | Don't adopt. There's no function at all for checking indent/bullet/numbering uniformity — exactly what block S needs; a focus on single-page layouts directly conflicts with a 196-page book. No ideas taken either — it's a toolset, not an analytical one. |
| Adobe Live Preflight (`PreflightProfile`, `app.preflightOptions`, the built-in API) | proprietary, part of InDesign | The official mechanism: a preflight profile with the "Paragraph and Character Style Overrides" rule finds local style overrides via the native UI/API. | Take the idea, not the code. Block S can either (a) walk the document line/character by line/character directly (Task 1's approach, already measured cheap and flexible), or (b) generate a `PreflightProfile` programmatically and read `doc.preflightResults`. Path (b) hasn't been tried or measured in practice — worth a separate probe in Phase 3 if (a) turns out to be insufficiently precise specifically for bullets/numbering (preflight targets paragraph/character styles, not lists directly). |
| [typograf](https://github.com/typograf/typograf) (JS, mirror of golmakov/typograf) | MIT | A JS/Node auto-typography library with localization (dozens of locales; a `locale-uk` theme's existence in the project's ecosystem is confirmed, though not explicitly listed in the README). | Don't adopt as a dependency. Our own B2 pipeline (`src/typography/rules-uk.ts`) is already written in TypeScript on top of our own `regexRule`, tested (24 tests from `task-11-brief.md`), and deliberately distinguishes `high`/`needs-review` — an automatic converter like typograf doesn't make that distinction. Used only to cross-check the rule list (see the section below). |
| [indesign-uxp-scripting](https://github.com/RolandDreger/indesign-uxp-scripting) (RolandDreger) | MIT (the collection itself; the content is mostly links) | A curated collection of links to official UXP documentation and articles, incl. `what_does_not_work.md` — a list of known UXP panel gaps. | Don't adopt as a dependency (not a library, a list of links). Used as one of two sources for the "UXP vs ExtendScript" section above. |

Overall conclusion: **no ready-made, purpose-built solution for block S (indent/bullet/numbering
uniformity) was found in the public space.** The closest thing is the built-in Adobe Preflight API
(not third-party), worth a separate probe before Phase 3. For the rest of the findings
(ExtendScript frameworks, IDML parsers, general-purpose typography libraries), the decision is not
to adopt them, with the rationale in the table.

## Adobe MCP

**Decision:** do not rely on Adobe MCP tools (`export_idml`, `convert_pdf_to_indd`,
`prepare_indd_merge_template`, `document_merge_data_layout`, and others from that same server) for
any Phase 3–5 task that works with the user's LIVE open document.

**Rationale:**
- These tools were NOT called in this session: the Adobe MCP servers are connected but require
  authorization that isn't currently available. The assessment below relies solely on Adobe's
  public documentation (Firefly Services / InDesign APIs), with no invented call results.
- Per the documentation, these APIs are architected as a cloud, server-side render service. Input
  and output files are passed ONLY as presigned URLs (AWS S3, Dropbox, Azure Blob via a Shared
  Access Signature; Google Cloud with a caveat about an allowlist for custom domains). The service
  downloads input files into its own working folder on its side, processes them, and uploads the
  result back via a presigned URL. There is no mention anywhere in the documentation of connecting
  to an already-running local InDesign, or of working with an arbitrary path on the user's local
  file system.
- The consequence of this architecture for our scenario: to use these MCP tools, you would need to
  (a) save/close the document, (b) upload a copy of the file to cloud storage, (c) call the API,
  (d) download the result and manually reconcile it with the live document — that is, the work
  happens NOT on the open document, but on a separate copy of the file outside InDesign. This
  contradicts the project's model (mutations via `osascript` in a live InDesign, Phase 1) and
  doesn't remove any Phase 3–5 task — all of them are precisely about reading/writing an open
  document, not batch generation from a template.
- **Not established in practice:** whether authorized calls actually behave as the general Firefly
  Services API documentation describes (the documentation describes the API itself, not these
  specific MCP tool wrappers — there could be differences in the wrapper). Worth checking with one
  trial call as soon as authorization becomes available in a future session — before writing these
  tools off entirely, even for auxiliary offline scenarios (e.g., batch-generating PDF reports
  outside the live document, where the cloud model wouldn't be an obstacle).

**Consequence for Phases 3–5:** none of them rely on Adobe MCP; the only channel for interacting
with the document remains the existing bridge (`osascript` + ExtendScript via temp JSON files,
`src/bridge/runner.ts`).

## Sources for the Ukrainian rules

**Decision:** the set of three chosen rule groups already in `task-11-brief.md` (spacing and
clutter; dashes and hyphens; quotes/apostrophe/periods) is already consistent with the authoritative
sources below — use those sources as a reference cross-check (code comments, a future review), not
as a separate library or a source of new rules. This recon doesn't call for changes to the
already-designed rule set.

**Rationale and verified exceptions:**
- The 2019 orthography is the current source (English Wikipedia: "Ukrainian orthography of 2019";
  approved by the Cabinet of Ministers on 2019-05-22, in effect since 2019-05-30).
- **Apostrophe.** Wikipedia ("Rules for using the apostrophe in the Ukrainian language") gives a
  full list of cases where an apostrophe is NOT placed despite superficial similarity of context: a
  labial before a root with no prefix, after a soft р («дзвякнути, свято, медвяний», but «торф'яний»
  — already has a prefix), soft ря/рю/рє («буряк, крюк, гарячий»), before the digraph «йо»
  («курйоз, серйозний»), in surnames and place names where я/ю mark softening rather than /j/
  («Рюмін, Вязьма»). **Important for B2:** all of this is about WHETHER to place an apostrophe at
  all (an orthographic decision, outside this task's scope), not about converting an
  already-present apostrophe character into a typographic one. The `apostrophe` rule in
  `rules-uk.ts` only converts an already-present character (`'`, `` ` ``, etc.) between two letters
  into the typographic `’` — so this list of exceptions doesn't apply to it and requires no changes.
- **Dash and hyphen.** [typography.org.ua](https://typography.org.ua/) and
  [stravopys.com](https://stravopys.com/uk/blog/guides/typography-quotes-dashes-abbreviations)
  agree in describing: a hyphen is an orthographic mark inside a compound word with no spaces; a
  dash (—) is a punctuation mark with spaces on both sides; a short dash (–) is used for ranges
  with no spaces («1945–1947 рр.»), with a fixed exception for decades, which get spaces around the
  dash («40-х – 50-х рр.»). Neither source gives an exhaustive formal list of WHEN a hyphen between
  spaces should NOT become a dash (phone numbers, geographic ranges like «Київ-Львів» versus
  compound words like «синьо-жовтий») — both stick to examples. This confirms: the project's
  decision to route such ambiguous matches into `needs-review` rather than auto-correct
  (`rules-uk.ts`, the `dashSeparator` rule with its check for adjacent digits, and `rangeDashWords`
  always `needs-review`) is not a simplification, but an accurate reflection of the fact that the
  external sources themselves don't formalize this boundary precisely enough to automate it fully
  and safely.
- **Quotes and nesting. Fixed after review — the previous wording, "both sources agree," was wrong
  for both sources; here is what they actually say:**
  - [typography.org.ua](https://typography.org.ua/) has a separate "Nested quotes" section with a
    direct rule (quoted): "if more quotes are needed inside quoted text, the inner ones must differ
    from the outer ones: outer «guillemets», inner "English ones"", example: «Це мій "Кобзар"», —
    сказав він». The same site separately calls the „ " style "German quotes" and labels the
    recommended context as "handwritten" — i.e., as the style of the WHOLE text (an alternative to
    "guillemets"), NOT as a marker of nesting depth. This directly contradicts the previous version
    of this document, where „ " was described as a nesting level.
  - [stravopys.com](https://stravopys.com/uk/blog/guides/typography-quotes-dashes-abbreviations) is
    completely SILENT on nested quotes: the page picks one style (French «...» or German „...")
    for the whole text and never raises the question of quotes inside quotes.
  - **Chosen convention:** outer «guillemets», inner "English" straight-style quotes — this is a
    user decision from 2026-07-31, made precisely because of this disagreement between sources
    (not because of an invented agreement between them); the plan and spec are already corrected
    (commit `9053406`), and the `matchQuotes` rule in `rules-uk.ts` is being reworked to match the
    new convention. The exception that "inches after a number don't become quotes" (`15"`) remains
    the project's own decision — no confirmation or contradiction was found in the sources.
- [typograf (JS)](https://github.com/typograf/typograf) — usable as a cross-check source for the
  rule list (claims support for many locales, including Ukrainian, within the project's ecosystem),
  but not used as a library: our own implementation is already written, covered by tests, and
  deliberately distinguishes `high`/`needs-review` — a distinction the automatic typograf converter
  doesn't make.
- **Not established:** a dedicated official publishing standard along the lines of a ДСТУ, with an
  exhaustive and formal list of exceptions for hyphen↔dash auto-replacement in Ukrainian-language
  book publishing, could not be found. Both sources found are practical guides for
  designers/editors (typography.org.ua, stravopys.com), not a normative document. This doesn't
  block Task 11's work: the current rule set is already conservative and routes anything doubtful
  into `needs-review` instead of silent auto-correction. But if auto-correction ever needs to be
  EXPANDED (turning some `needs-review` cases into `high`), no normative source for that has been
  found yet — worth searching further or consulting a professional editor.
