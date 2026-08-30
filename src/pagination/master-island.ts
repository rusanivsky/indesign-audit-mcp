import type { PageRef } from "./types.js";

/**
 * FOREIGN MASTER ISLAND — a page dressed differently from its same-side neighbors.
 *
 * WHY THIS EXISTS. Before going to print, p. 188 of the working book turned out to
 * be missing its folio. The cause, as named by the author: forgot to reassign
 * the parent master page. None of the twenty-two tools caught it, and not by
 * accident: `head-missing` (`heads.ts:287`) only fires when there IS AN
 * EXPECTATION for the page's master, and expectations are built FROM FRAMES ON
 * MASTERS (`src/tools/pagination.ts:793`). A foreign master promises nothing —
 * so there is no expectation, and hence no finding. Silence by construction.
 *
 * WHAT THIS DETECTOR DOES NOT DO. It does not assert that "a page inside a
 * section must have a folio" — that rule was deliberately dropped on
 * 2026-08-14 (`heads.ts:127-136`): 78 pages of the `Шаблон інтерв'ю` master
 * have no folio BY DESIGN, and such a rule would produce 39 false findings.
 * The question here is different and narrower: not "does this page have a
 * folio", but "is it dressed the same way as the neighboring pages on the
 * same side".
 *
 * REPORTS A CANDIDATE, NOT A VERDICT. A title page, half-title, divider, or a
 * full-bleed illustration page legitimately have their own master. The
 * document alone cannot distinguish intent from oversight — only a person can.
 *
 * ──────────────────────────── MEASUREMENT ────────────────────────────
 *
 * The target and two files for comparison — `tests/unit/fixtures/book-master-map.json`
 * (probe `scripts/probe-foreign-master.jsx`, 2026-08-18, InDesign 21.5.1.73).
 * The "page → master" maps of the two book versions differ in EXACTLY ONE
 * place, and that is p. 188: `G-Шаблон без колонтитулів` → `J-Розділ 3 текст
 * колонтитули`. So the oracle here was not constructed — it was found.
 *
 * MEASUREMENT DISPROVED THE PLAN TWICE, AND NEITHER TIME WOULD HAVE BEEN VISIBLE FROM READING ALONE.
 *
 * 1. "INSIDE A LONG EVEN RUN" — the run is NOT long. The design called for
 *    neighboring homogeneous runs to be long. Measured: the run before p. 188
 *    is three pages (182, 184, 186), after it — two (190, 192). At
 *    `minRun = 3` there are ZERO candidates and the target is LOST. Measured
 *    numbers across 196 pages:
 *
 *      minRun = 1 → 16 candidates, target present
 *      minRun = 2 →  4 candidates,  target present   ← chosen
 *      minRun = 3 →  0 candidates, target ABSENT
 *
 *    `minRun = 1` isn't noisy in the abstract: 10 of its 16 candidates are two
 *    ALTERNATIONS (J/N on pp. 164-170 and D/M on pp. 119-125), i.e. a
 *    deliberate "chapter text — checklist" rhythm, not a defect. It is
 *    precisely the `minRun ≥ 2` requirement that kills the alternation.
 *
 * 2. MATCHING THE SET OF PARAGRAPH STYLES DOES NOT STRENGTHEN THE SIGNAL — it
 *    cannot be used as a gate. The design said: reinforce with a style match
 *    against neighbors ("looks like body text but dressed differently").
 *    Measured similarity (Jaccard to both neighbors, averaged) across the four
 *    candidates at `minRun = 2`:
 *
 *      p. 188 — 0.191   ← the REAL defect
 *      p. 167 — 0.125
 *      p. 108 — 0.292
 *      p.  49 — 0.393
 *
 *    The target sits IN THE MIDDLE of the range: no threshold exists that
 *    would separate it from the rest. A "similarity above X" threshold would
 *    drop p. 188 along with p. 167, and "below X" would drop it along with
 *    p. 108 and p. 49. So the style set does not enter the detector AT ALL,
 *    neither as a gate nor as a weight.
 *
 * WHAT THIS DETECTOR PRODUCES ON THE BOOK WHERE THE INCIDENT HAPPENED: four
 * candidates out of 196 pages, and the real defect among them. One of the
 * other three — p. 167 — carries the SAME signature shape as the target
 * (`G-Шаблон без колонтитулів` inside a `J` run), and in the CURRENT file it
 * is likewise `G`. This is either a deliberate divider or a second forgotten
 * master; the tool does not decide which — it NAMES both.
 *
 * COST OF MEASUREMENT — ZERO. `PageRef.master` is already collected by
 * `pagination_measure` (`src/jsx/pagination.jsx:1303`), so the detector adds
 * no additional calls into InDesign. The expensive `document_map` (928 s
 * across 592 pages) is not needed here — yet that is exactly what the plan
 * pointed to.
 */

/** Minimum run of same-side neighbors. The number is MEASURED — see the comment above. */
export const DEFAULT_MIN_RUN = 2;

export interface MasterIslandCandidate {
  /** Name of the island page. */
  page: string;
  side: PageRef["side"];
  /** Master applied to it. */
  master: string;
  /** Master shared by same-side neighbors. */
  neighbourMaster: string;
  /** How many consecutive pages before it carry `neighbourMaster`. */
  runBefore: number;
  /** How many after. */
  runAfter: number;
}

export interface MasterIslandOptions {
  /**
   * Minimum length of a homogeneous run on EACH side.
   *
   * The default of 2 is MEASURED, not chosen: 1 gives 16 candidates (10 of
   * them deliberate alternations), 3 loses the target. Left as a parameter
   * because the alternation rhythm is a property of the edition, not of the
   * tool: a book where chapter text and checklists come in pairs would need 3.
   */
  minRun?: number;
}

/**
 * Candidates for "foreign master", one entry per page.
 *
 * Adjacency is counted BY SIDE (verso with verso, recto with recto), because
 * it is the side that determines which master a page belongs to: a spread in
 * a book with mirrored margins has two different masters by construction, and
 * comparing across the spread would flag half the book.
 */
export function detectMasterIslands(
  pages: readonly PageRef[],
  opts: MasterIslandOptions = {},
): MasterIslandCandidate[] {
  const minRun = opts.minRun ?? DEFAULT_MIN_RUN;
  if (!Number.isInteger(minRun) || minRun < 1) {
    throw new Error(
      `detectMasterIslands: minRun must be an integer ≥ 1, got ${minRun}. ` +
        "Zero would mean \"don't ask the neighbors\", i.e. every template change becomes a candidate.",
    );
  }

  const bySide = new Map<PageRef["side"], PageRef[]>();
  for (const p of [...pages].sort((a, b) => a.offset - b.offset)) {
    const bucket = bySide.get(p.side);
    if (bucket === undefined) bySide.set(p.side, [p]);
    else bucket.push(p);
  }

  const out: MasterIslandCandidate[] = [];
  for (const [side, list] of bySide) {
    for (let i = 1; i < list.length - 1; i++) {
      const page = list[i]!;
      const prev = list[i - 1]!;
      const next = list[i + 1]!;

      /*
       * A page with no master applied is NOT an island. `null` here means
       * "master removed", and that is a deliberate layout decision, not
       * "a different master": the tempting `null !== "J"` comparison would
       * turn every intentionally bare page into a candidate. Likewise, a
       * neighbor with no master cannot serve as a reference — there is
       * nothing to compare against.
       */
      if (page.master === null || prev.master === null || next.master === null) continue;

      /* Neighbors must agree WITH EACH OTHER: otherwise this is not an island but
       * the boundary between two different regions, and the page between them
       * legitimately belongs to either. */
      if (prev.master !== next.master) continue;
      if (page.master === prev.master) continue;

      let runBefore = 0;
      for (let j = i - 1; j >= 0 && list[j]!.master === prev.master; j--) runBefore++;
      let runAfter = 0;
      for (let j = i + 1; j < list.length && list[j]!.master === next.master; j++) runAfter++;
      if (runBefore < minRun || runAfter < minRun) continue;

      out.push({
        page: page.name,
        side,
        master: page.master,
        neighbourMaster: prev.master,
        runBefore,
        runAfter,
      });
    }
  }

  /* Document order, not the order sides were traversed in: the report's reader goes by page. */
  const offsetOf = new Map(pages.map((p) => [p.name, p.offset]));
  return out.sort((a, b) => (offsetOf.get(a.page) ?? 0) - (offsetOf.get(b.page) ?? 0));
}
