/**
 * `pagination_audit` report.
 *
 * RESPONSE SHAPE — FINDINGS PLUS COUNTERS ONLY, and this isn't a style
 * choice but a computed necessity (spec §5.2). Estimate on the real book:
 * ~99 folios + ~80 contents lines + ≤198 running heads ≈ 380 claims; if
 * each rode as a line at ~300 B, that would be ~114 KB — MORE than the
 * 78 KB that already knocked the tool out once in Phase 4. So the full
 * listing only goes through `detail`, with its own ceiling.
 */

import type { MasterIslandCandidate } from "./master-island.js";
import {
  MAX_PAGINATION_DETAIL_ITEMS,
  type FamilyResult,
  type MasterSkip,
  type PaginationDefect,
  type PaginationFinding,
} from "./types.js";

export type FamilyName = "folio" | "contents" | "runningHead";

/**
 * Ceiling on the page listing within a group.
 *
 * A ceiling with margin, NOT a measurement: on the working book the
 * `folio-manual` group has 91 pages, i.e. it gets truncated. Twenty is
 * enough to see the pattern ("all even", "41 through 195"), and the full
 * address listing goes through `detail`.
 */
export const MAX_GROUP_PAGES = 20;

/**
 * Identical findings folded into one line.
 *
 * WHY THIS IS NEEDED — from measurement, not aesthetics. On the working
 * book the `folio` family produced 91 `folio-manual` findings and a
 * 33,437 B response, to say ONE thing: all folios are partly hand-typed.
 * A third of the 78 KB limit was eaten by repeating the same text.
 *
 * GROUPED BY `defect`, not by the value pair. On that same book each of
 * the 91 findings has its OWN `claimed` (2, 4, 6, …), so grouping by
 * value wouldn't have folded a single one. The useful signal here is
 * "all 91", not a list of numbers.
 *
 * What's NOT lost in the process: the explanation (in `example`), the
 * pages (in `pages`, up to the ceiling), the count (`count`), and the
 * full addresses (via `detail`).
 */
export interface DefectGroup {
  defect: PaginationDefect;
  count: number;
  /** Pages where this defect occurred; truncated by the ceiling. */
  pages: string[];
  /** Present only when the page listing was truncated — a silent
   * truncation would read as "that's all of them". */
  pagesTruncated: { shown: number; total: number } | null;
  /** One full finding from the group: so the explanation text doesn't
   * disappear along with the summary. */
  example: PaginationFinding;
}

export interface FamilyReport {
  /**
   * Checked CLAIMS, not layout frames: a master frame produces a
   * separate claim for each page it's visible from (details — `checked`
   * in `FamilyResult`). On the book, 160 claims come from 91 drawn
   * frames plus 2–3 master objects.
   */
  checked: number;
  deviating: number;
  notCompared: number;
  /**
   * Rolled up by defect. There is deliberately NO per-item listing here —
   * it cost 33 KB on the real document; full addresses go through
   * `detail`.
   */
  groups: DefectGroup[];
}

export interface PaginationReport {
  docName: string;
  folio: FamilyReport | null;
  contents: FamilyReport | null;
  /**
   * The running-head family. `null` — it wasn't declared; an empty
   * report here would read as "all clean", and that's not the same thing.
   */
  runningHead: FamilyReport | null;
  detail: PaginationFinding[] | null;
  detailTruncated: { shown: number; total: number } | null;
  missingStyles: string[];
  /**
   * Frames of DECLARED styles that sit on parent pages and are therefore
   * invisible to the `contents`/`headings` families (spec §4.1).
   *
   * Sits next to `missingStyles` and for the same reason: both fields
   * exist so an empty report doesn't read as "all clean". `missingStyles`
   * catches a style that isn't in the document at all; this field catches
   * a style that exists but sits where the measurement deliberately
   * doesn't look.
   *
   * WHAT AN EMPTY ARRAY ACTUALLY MEANS — NAMED EXCEPTIONS, NOT IN
   * GENERAL. An earlier draft said "we looked and missed nothing", and
   * that was FALSE: the counter only saw the style of the FIRST
   * paragraph, so a declared heading as the second paragraph of a master
   * frame came back empty here, with the accounting going into
   * `undeclared`, which doesn't ride into the report (proven by
   * execution, review `49faac5`). Now the accounting follows the same
   * path as the collection itself: per-frame for `number`/`title`,
   * per-paragraph for `heading`. So an empty array means "we looked and
   * missed nothing" with an exception that can't be counted from
   * anywhere: when the DOM didn't return a style name, there's nothing to
   * write here — there's no name for the record. The exception has TWO
   * scales, and the earlier draft only named the smaller one:
   *
   * - the FIRST paragraph's style (or the paragraph collection itself)
   *   failed to read — the WHOLE FRAME drops out, along with all later
   *   paragraphs whose styles read fine. `if (styleName === null)
   *   continue;` (`src/jsx/pagination.jsx:970`) sits BEFORE the
   *   `fromMaster` block, so the frame never even reaches
   *   `undeclared`, i.e. it disappears from the negative control too.
   *   The loss is PER-FRAME;
   * - a later paragraph's style failed to read — only that paragraph
   *   drops out (`hsStyle === null` in the per-paragraph loop). The
   *   loss is PER-PARAGRAPH.
   *
   * The reach of both is tiny: `IDMCP.styleNameOf` only returns `null`
   * on a DOM exception while reading `appliedParagraphStyle.name`.
   *
   * `undeclared` does NOT ride into the report: those are master frames
   * nobody declared (running heads), and the book has hundreds of them —
   * the response shape here is a computed necessity (§5.2), not taste.
   * The number stays in the measurement.
   */
  masterSkipped: MasterSkip[];
  /**
   * Pages dressed differently from their neighbors on the same side —
   * CANDIDATES.
   *
   * WHY THIS FIELD EXISTS. Before going to print, page 188 of
   * the working book turned out to have no running head: someone forgot to
   * reassign the parent master. `head-missing` doesn't see this BY
   * CONSTRUCTION — expectations are built from frames on masters, and a
   * foreign master promises nothing, so there's nothing to violate. The
   * silence wasn't an implementation bug, it was a consequence of the
   * model.
   *
   * CANDIDATES, NOT FINDINGS: they belong to no family's `deviating` and
   * don't trip the gate. A title page, a half-title, a divider, and a
   * full-bleed illustration page legitimately have their own master, and
   * the document gives no way to tell intent from oversight apart.
   *
   * ACCURACY WAS MEASURED on the book where the incident happened: four
   * candidates across 196 pages, with the real defect among them
   * (`tests/unit/pagination-master-island.test.ts`).
   */
  masterIslands: MasterIslandCandidate[];
}

export interface BuildReportInput {
  docName: string;
  folio: FamilyResult | null;
  contents: FamilyResult | null;
  runningHead: FamilyResult | null;
  missingStyles: string[];
  masterSkipped: MasterSkip[];
  /**
   * Pages dressed differently from their neighbors on the same side
   * (`src/pagination/master-island.ts`).
   *
   * CANDIDATES, NOT FINDINGS, and so they belong to no family's
   * `deviating`: a title page, a half-title, and a divider legitimately
   * have their own master. The document gives no way to tell intent from
   * oversight apart.
   *
   * Cost is zero: `PageRef.master` is already collected by
   * `pagination_measure`.
   */
  masterIslands: MasterIslandCandidate[];
  detailFamily: FamilyName | null;
}

/**
 * Defects that are NOT a number mismatch.
 *
 * `folio-manual` says "this number was hand-typed" — the frame may
 * currently hold entirely correct numbers RIGHT NOW. Counting it in
 * `deviating` would mean reporting a defect where none exists; dropping
 * it from the report would mean staying silent about it breaking on the
 * next recomposition. So it's in `findings`, but not in `deviating`.
 */
const NON_DEVIATIONS: ReadonlySet<PaginationDefect> = new Set<PaginationDefect>([
  "folio-manual",
  /* «Не порівняно», не «розійшлося» — див. types.ts. */
  "folio-ambiguous-page-name",
  /*
   * `folio-dormant-duplicate` — the same class as `folio-manual`: a
   * frame on a hidden layer doesn't print, so the number is correct
   * TODAY and will only break once the layer gets turned on. This is NOT
   * the same as `folio-marker-unbound` and
   * `folio-marker-cross-spread` (Phase 7, `src/pagination/types.ts`),
   * where the frame already prints now with a false number — those stay
   * in `deviating`.
   */
  "folio-dormant-duplicate",
  /*
   * `folio-unparsable` — THIS IS "NOT COMPARED", NOT "MISMATCHED", and
   * until now it was counted in `deviating`, contradicting its own
   * counter: the same frame landed in both `notCompared`
   * (`src/pagination/folio.ts`) and `deviating`. The finding asserts
   * nothing about the number — its `claimed` is `null`; it says "the
   * page name isn't a number, there's nothing to reconcile against".
   *
   * WHY THIS BECAME VISIBLE RIGHT NOW. The third source of frames (§4.1)
   * made master folios visible, and a finding is generated PER FRAME: on
   * the fixture, a page with a roman-numeral name now produces 2 instead
   * of 1; on a book with a roman-numbered foreword under a master
   * carrying a folio, `deviating` would double on every such page —
   * i.e. the defect count would grow from the SOURCE of frames, not from
   * the state of the layout.
   *
   * SEMANTICS, SAID OUT LOUD: the report's unit is a CLAIM (§4.3), so two
   * frames on one page produce two findings, and that's correct. What
   * was wrong was counting them as a mismatch.
   */
  "folio-unparsable",
  /*
   * `folio-marker-unmeasured` — the same class as `folio-unparsable`:
   * "not compared", not "mismatched". A frame with unknown bounds of its
   * own gives no grounds for either "clean" or a defect, so a finding
   * exists (otherwise it would be byte-for-byte indistinguishable from a
   * checked-and-clean one), but it's not in `deviating` — that must
   * hold only proven mismatches.
   *
   * Unlike `folio-unparsable`, this frame does NOT land in
   * `notCompared`, and that's not an inconsistency but arithmetic:
   * `checked` is already counted for it (the literals were reconciled
   * against the spread's makeup), only the marker's topology wasn't
   * reconciled, and Phase 6's per-frame counters don't express that
   * partial state.
   */
  "folio-marker-unmeasured",
  "contents-manual",
]);

function groupFindings(findings: PaginationFinding[]): DefectGroup[] {
  const byDefect = new Map<PaginationDefect, PaginationFinding[]>();
  for (const f of findings) {
    const bucket = byDefect.get(f.defect);
    if (bucket === undefined) byDefect.set(f.defect, [f]);
    else bucket.push(f);
  }

  const groups: DefectGroup[] = [];
  for (const [defect, list] of byDefect) {
    /* Pages are deduplicated: two findings on the same page shouldn't
     * double the listing. `count` still stays the number of FINDINGS,
     * not pages — these are different quantities, and they must not be
     * confused. */
    const seen: string[] = [];
    for (const f of list) {
      if (f.page !== null && !seen.includes(f.page)) seen.push(f.page);
    }
    const shown = seen.slice(0, MAX_GROUP_PAGES);
    groups.push({
      defect,
      count: list.length,
      pages: shown,
      pagesTruncated:
        seen.length > MAX_GROUP_PAGES ? { shown: shown.length, total: seen.length } : null,
      example: list[0]!,
    });
  }
  return groups;
}

function toFamilyReport(result: FamilyResult | null): FamilyReport | null {
  /*
   * null and "zero findings" are DIFFERENT states, and they must not be
   * merged: the former means "wasn't asked", the latter "looked and
   * found nothing". Phase 4's rule (`document_map.headings`).
   */
  if (result === null) return null;
  return {
    checked: result.checked,
    /* `deviating` counts FINDINGS, not groups: rolling up changes the
     * report's shape, not the size of the defect. */
    deviating: result.findings.filter((f) => !NON_DEVIATIONS.has(f.defect)).length,
    notCompared: result.notCompared,
    groups: groupFindings(result.findings),
  };
}

export function buildReport(input: BuildReportInput): PaginationReport {
  const families: Record<FamilyName, FamilyResult | null> = {
    folio: input.folio,
    contents: input.contents,
    runningHead: input.runningHead,
  };

  let detail: PaginationFinding[] | null = null;
  let detailTruncated: { shown: number; total: number } | null = null;

  if (input.detailFamily !== null) {
    const source = families[input.detailFamily];
    /*
     * A refusal, not a silent empty list: "empty" and "family wasn't
     * counted" are different states, and `[]` would merge them into
     * one. The same choice as in `styles_audit`.
     */
    if (source === null) {
      throw new Error(
        `A named list was requested for the family "${input.detailFamily}", but it is not ` +
          "declared in this call. Declare the family or remove detail — " +
          "an empty list would read as \"no findings\", and that is not the same thing.",
      );
    }
    const full = source.findings;
    detail = full.slice(0, MAX_PAGINATION_DETAIL_ITEMS);
    if (full.length > MAX_PAGINATION_DETAIL_ITEMS) {
      detailTruncated = { shown: detail.length, total: full.length };
    }
  }

  return {
    docName: input.docName,
    folio: toFamilyReport(input.folio),
    contents: toFamilyReport(input.contents),
    runningHead: toFamilyReport(input.runningHead),
    detail,
    detailTruncated,
    missingStyles: input.missingStyles,
    masterSkipped: input.masterSkipped,
    masterIslands: input.masterIslands,
  };
}
