# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the tool surface may change between minor
versions: a tool's parameters or response shape can move without a deprecation
cycle. The README's tool table is the current contract.

## [0.1.0] — 2026-08-29

First release.

### Added

- 24 MCP tools over a live InDesign 2026 document: `indesign_status`,
  `doc_overview`, `story_read`, `text_find`, `document_map`,
  `corrections_plan` / `corrections_apply`, `pdf_read_annotations`,
  `typography_audit` / `typography_apply` (locales `uk`, `en-US`, `en-GB`),
  `composition_audit` / `composition_apply`,
  `pagination_audit` / `pagination_apply`, `layout_audit`, `styles_audit`,
  `bibliography_audit` / `bibliography_apply`, `spelling_audit`,
  `geometry_audit`, `color_audit`, `preflight_document`, `page_render`, and
  `indesign_run_jsx`.
- A write envelope shared by the correction, typography, composition and
  bibliography tools: a backup copy, disabled modal dialogs, one undo step for
  the whole batch, and a text check immediately before each write.
- **Three bibliographic standards**, not one with flags: ДСТУ ГОСТ 7.1:2006 and
  ДСТУ 8302:2015 for Ukrainian material, and the Chicago Manual of Style for
  English. Chicago carries its own segmenter, because a ДСТУ record opens on a
  NUMBERED paragraph while a Chicago bibliography is unnumbered; on an English
  edition the Ukrainian path therefore reports zero records rather than wrong
  ones. Two Chicago rules are `needs-review` by construction: deleting a page
  extent can destroy a live page-number marker, and lowercasing a publisher can
  overwrite the house's own form of its name.
- Writes are confirmed BY RULE rather than by match. `bibliography_apply`
  requires `expectedRecords`, and a mismatch against the live count refuses the
  write outright; a rule id from another standard's family is refused by name
  rather than silently dropped.
- A standalone preflight CLI (`npm run build:audit`) that produces a bilingual
  HTML report as a single portable file — no `node_modules`, no network.
- Two privacy gates: one over the tracked file list, one over commit messages.
  The file gate reads `git ls-files`, so commit messages cannot reach it; the
  second closes that hole. Both fail loudly rather than skip, and both carry
  positive twins proving their detectors still fire. `private/` is where real
  edition data belongs.
- `npm run test:all` — typecheck, then unit, then integration. The only
  complete gate. `npm test` is unit only and cannot run integration, which
  needs a live InDesign.
- `THIRD-PARTY-NOTICES.md`, `licenses/` and a licence notice beside
  `tests/fixtures/hunspell-oracle.json`: that fixture is derived from the
  Hunspell dictionaries InDesign ships and is not MIT. It is not in the npm
  package, and a test keeps the carve-out from going quiet.
