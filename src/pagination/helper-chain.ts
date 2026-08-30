/**
 * THE FOURTH DETECTOR — HELPER-CHAIN INTEGRITY (Phase 8 spec, §4.2).
 *
 * Fires BEFORE the numbers go wrong. Today the tool sees no difference
 * between "chain intact" and "chain broken": a run on a copy of the book on
 * 2026-08-08 gave 167 frames on 196 pages and 25 folios with the wrong
 * spread — i.e. only the CONSEQUENCES, and no cause at all.
 *
 * WHY A SEPARATE MODULE, NOT A BRANCH OF `detectFolio`. `detectFolio`'s
 * unit is the folio frame, and all its counters are per-frame. This
 * detector's unit is the PAGE (gap, order, split) and the DOCUMENT (layer).
 * Squeezing a second unit into the same function would mean either breaking
 * the `checked`/`notCompared` arithmetic, or silently working around it —
 * exactly what fix round 2 of Phase 7 untangled for `folio-unparsable`.
 *
 * DOESN'T TOUCH THE COUNTERS — that's why the function returns a bare array
 * of findings, not a `FamilyResult`. The precedent is exact
 * (`detectMarkerDefects` doesn't touch them either), but the reason here is
 * stronger: counting a page with no frame into `checked` OF NUMBER ASSERTIONS
 * would mean counting an assertion that doesn't exist.
 *
 * THERE IS NO `range` PARAMETER, and that's decisive (the same decision as
 * Phase 7's §4.9). The helper chain's "range" is the whole document BY
 * CONSTRUCTION: the `pagination_create_helper_thread` handler places a frame
 * on every page with no narrowing parameter at all, because a subrange would
 * promise, on its own first page, the page `offset − 1`, for which no frame
 * would be created. So the reference is derived from the whole document, and
 * `pagination_audit`'s public schema doesn't change.
 *
 * FOUR DEFECTS, NOT THREE, AND THE FOURTH IS THE MOST IMPORTANT. The phase
 * brief named three properties; probe `H8` (Question 2) measured a fourth
 * and showed it's the most common: `page.duplicate()` — a routine operator
 * action — leaves a frame on EVERY page and a monotonic order in the main
 * story, i.e. `gap` and `unordered` stay silent while the numbers have
 * already drifted. Only `folio-helper-chain-split` catches this.
 */

import type { HelperChainMeasure, HelperFrameRef, PaginationFinding } from "./types.js";

/**
 * The links of one story, ordered the way they sit IN THE CHAIN.
 *
 * The order of the `frames` array is the traversal order of
 * `layer.pageItems`, and it MATCHES NEITHER the page order nor the chain
 * order: measured (`H8`, Question 3b) — after unstitching, six frames came
 * in story order `256, 412, 393, 450, 431, 469` while the pages were
 * `1,3,2,5,4,6`. So the one source of order is `orderInStory`.
 */
function byStory(frames: HelperFrameRef[]): Map<string, HelperFrameRef[]> {
  const out = new Map<string, HelperFrameRef[]>();
  for (const f of frames) {
    if (!measured(f)) continue;
    const bucket = out.get(f.storyId);
    if (bucket === undefined) out.set(f.storyId, [f]);
    else bucket.push(f);
  }
  for (const list of out.values()) list.sort((a, b) => a.orderInStory - b.orderInStory);
  return out;
}

/**
 * Whether the things the order and split checks rely on are ESTABLISHED for
 * this link at all.
 *
 * TWO "WASN'T MEASURED" STATES, AND BOTH PRODUCE A MADE-UP DEFECT IF NOT
 * FILTERED OUT:
 *
 * - `orderInStory === -1` — the frame wasn't found among its own story's
 *   containers. Minus one sorts FIRST, so a link with a large `pageOffset`
 *   would become the head of the chain and the next comparison would report
 *   a "gap" that doesn't exist;
 * - `storyId === ""` — the story name failed to read (a DOM exception seen
 *   during measurement). An empty string isn't a name, it's the absence of
 *   one, and grouping by it isn't safe: one such link would become its own
 *   "chain", i.e. it would produce `folio-helper-chain-split` where the
 *   measurement simply failed.
 *
 * WHY A FILTER, NOT A FIFTH DEFECT. §3 calls a made-up defect a worse
 * failure than a missed one, and both states are unreachable by any known
 * path: the first would mean a frame doesn't belong to its own story, the
 * second an exception while reading `parentStory.id`. Raising a finding for
 * a state nobody has ever observed is the same mistake Phase 7's §4.9
 * avoided with `layerPrintable`. The boundary is named here; if this state
 * is ever seen live, it needs its own channel, like
 * `folio-marker-unmeasured`, not a silent filter.
 */
function measured(f: HelperFrameRef): boolean {
  return f.orderInStory >= 0 && f.storyId !== "";
}

/** The smallest `pageOffset` among the links, or `null` if none is on a page. */
function firstOffset(links: HelperFrameRef[]): number | null {
  let best: number | null = null;
  for (const l of links) {
    if (l.pageOffset === null) continue;
    if (best === null || l.pageOffset < best) best = l.pageOffset;
  }
  return best;
}

/**
 * THERE'S DELIBERATELY NO PAGE LIST HERE, and that's not a shortcut in the
 * signature.
 *
 * Pages without a link are counted by the MEASUREMENT (`pagesWithoutFrame`),
 * because that's where the coverage table built by that very same pass
 * lives. Counting them a second time here, from `pages` and `frames`, would
 * mean running TWO independent computations of the same quantity — and
 * sooner or later they'd diverge, and the report would start contradicting
 * itself. The same reasoning that made Phase 7 collapse `helperChainWins`
 * into one function for two questions instead of two predicates.
 */
export function detectHelperChain(chain: HelperChainMeasure | null): PaginationFinding[] {
  /*
   * `null` means THERE'S NO LAYER AT ALL, i.e. no chain was ever built and
   * there's nothing to be broken. The tempting fix `chain ?? empty` would
   * give EVERY document without the layer as many `gap` findings as it has
   * pages — the same trade of visibility for noise, just in the other
   * direction. The same lesson as `ClaimFrame.overlaps` (`null` vs `[]`).
   */
  if (chain === null) return [];

  const findings: PaginationFinding[] = [];

  if (!chain.layerVisible) {
    /*
     * ONE FINDING PER DOCUMENT, `page: null`. Spreading it across pages
     * would mean reporting N defects for one click on the "eye" icon.
     *
     * `layerPrintable` is NOT included here: measured (Question 8, Phase 7)
     * that `printable = false` does NOT break marker resolution (16 out of
     * 16), unlike `visible = false` (13 instead of 12 in the PDF). Two
     * boolean fields of the same shape behave oppositely, and
     * `printable = false` is exactly the ROUTINE state of this layer.
     */
    findings.push({
      id: "folio:helper-chain:hidden",
      family: "folio",
      defect: "folio-helper-chain-hidden",
      page: null,
      frameId: null,
      paragraphIndex: null,
      claimed: null,
      actual: chain.layerName,
      detail:
        `The helper-chain layer "${chain.layerName}" is HIDDEN. Measured: a hidden ` +
        "layer SUPPRESSES resolving the neighbor-page marker, meaning every automatic " +
        "folio silently prints \"N\u2013N\", and it looks the same as always. Not being printable " +
        "(printable = false) has NO such effect and is this layer's normal state — " +
        "the two flags must not be confused. Turn the layer's visibility on; it still " +
        "won't end up on the printed sheet.",
    });
  }

  for (const name of chain.pagesWithoutFrame) {
    findings.push({
      id: `folio:helper-chain:gap:${name}`,
      family: "folio",
      defect: "folio-helper-chain-gap",
      page: name,
      frameId: null,
      paragraphIndex: null,
      claimed: null,
      actual: null,
      detail:
        `There's no helper-chain link under page ${name}: measured — the marker takes ` +
        "the number from the chain's PREVIOUS FRAME's page, not \"current minus one\", so " +
        "a single missing link shifts the folios on ALL the following pages, while leaving them " +
        "looking correct. The most likely cause is a page added after the chain " +
        "was built (deleting a chain page doesn't break it — InDesign re-stitches the neighbors " +
        "itself). Fix: pagination_apply with operation: \"repair-helper-thread\".",
    });
  }

  const stories = byStory(chain.frames);

  /*
   * ORDER — WITHIN A STORY, NOT ACROSS THEM. Two stories have their own
   * `orderInStory` numbering, so stitching them into one row for comparison
   * would give a false "gap" at every seam. The split itself is caught by a
   * separate defect below.
   *
   * Orphan frames (`pageOffset === null`) DROP OUT of the comparison: they
   * have no page, so "earlier or later" isn't defined for them. The repair
   * removes them, and it's the repair that reports on them — here they stay
   * silent, so as not to raise a defect that sends the operator the wrong way.
   */
  for (const links of stories.values()) {
    const placed = links.filter((l) => l.pageOffset !== null);
    for (let i = 1; i < placed.length; i += 1) {
      const prev = placed[i - 1]!;
      const cur = placed[i]!;
      /*
       * STRICT `>`, NOT `>=`. Two links on the SAME page (equal `offset`)
       * are the job of repair step 1, not an order defect: the order isn't
       * violated in that case. The `>=` mutant is caught by the test "equal
       * offset is not considered a gap".
       */
      if (prev.pageOffset! > cur.pageOffset!) {
        findings.push({
          id: `folio:helper-chain:unordered:${cur.frameId}`,
          family: "folio",
          defect: "folio-helper-chain-unordered",
          page: cur.page,
          frameId: cur.frameId,
          paragraphIndex: null,
          claimed: String(cur.orderInStory),
          actual: String(cur.pageOffset),
          detail:
            `The helper-chain link on page ${cur.page ?? "?"} sits in the chain ` +
            `AFTER the link from page ${prev.page ?? "?"}, even though it comes earlier in the document. ` +
            "The marker takes its number from the page of the previous FRAME, so a shuffled link gives " +
            "a number from the wrong place — and on the printed sheet it looks plausible. Fix: " +
            "pagination_apply with operation: \"repair-helper-thread\".",
        });
      }
    }
  }

  /*
   * SPLIT — AND THIS IS THE ONLY DETECTOR THAT CATCHES A DUPLICATED PAGE.
   *
   * Measured (`H8`, Question 2): `page.duplicate()` copies the helper frame
   * along with the page, but does NOT stitch the copy into the chain. The
   * result: `pagesWithoutFrame` is empty (there's a frame on every page),
   * the main story's order is monotonic (`1,2,3,5,6,7`) — both detectors
   * above stay silent — yet the chain is broken: the split-off link has no
   * previous frame and prints ITS OWN page number, and every link after it
   * carries a number one too low.
   *
   * THE LONGEST CHAIN IS CONSIDERED THE MAIN ONE, and on equal length, the
   * one that starts earlier. Both rules are needed: without the first, on a
   * 1+6 split the six-link chain would be declared "extra" and the operator
   * would go fix the wrong entire chain; without the second, the report
   * would be non-deterministic on the very same document, which is the
   * worst thing a detection tool can do.
   */
  if (stories.size > 1) {
    const ranked = [...stories.entries()].sort((a, b) => {
      const byLength = b[1].length - a[1].length;
      if (byLength !== 0) return byLength;
      const oa = firstOffset(a[1]);
      const ob = firstOffset(b[1]);
      /* A chain with no pages at all cannot be the main one. */
      if (oa === null && ob === null) return 0;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob;
    });

    const mainLength = ranked[0]![1].length;
    for (const [storyId, links] of ranked.slice(1)) {
      const head = links.find((l) => l.page !== null) ?? links[0]!;
      findings.push({
        id: `folio:helper-chain:split:${storyId}`,
        family: "folio",
        defect: "folio-helper-chain-split",
        page: head.page,
        frameId: head.frameId,
        paragraphIndex: null,
        claimed: String(links.length),
        actual: String(mainLength),
        detail:
          `The helper frame on page ${head.page ?? "off-page"} is NOT STITCHED to ` +
          `the main helper chain: it's in a separate story with ${links.length} ` +
          `link(s) vs. ${mainLength} in the main one. The frame IS on the page, and ` +
          "the main chain's order isn't broken, so the rest of the checks stay silent here — " +
          "but the marker over this page has no previous frame and will print its OWN " +
          "page, and every following one will take a number one link short. Measured: this is exactly " +
          "how page duplication behaves in InDesign: the helper frame's copy " +
          "gets created, but isn't stitched into the chain. Fix: pagination_apply with " +
          "operation: \"repair-helper-thread\".",
      });
    }
  }

  return findings;
}
