/**
 * Reference boundaries, DERIVED FROM THE DOCUMENT.
 *
 * No constant of this particular layout lives here and none may: the rule must
 * generalize to future editions, so the reference is taken from the margins,
 * columns, and bleed of the document ITSELF.
 *
 * Everything is in the OWN PAGE's coordinate space, from (0, 0). `page.bounds`
 * (spread space) never appears here at all: mixing the two spaces produced,
 * in the H13 measurement, 545 of 546 elements "outside the type area", and on
 * verso this error is invisible.
 */
import { EPSILON } from "./types.js";
import type { Bounds, PageMeasure } from "./types.js";

/** Type area: [y1, x1, y2, x2] in page space. */
export function typeArea(page: PageMeasure): Bounds {
  /* On verso, the inner margin lies on the RIGHT — the ONLY place mirroring
   * happens in the whole tool.
   *
   * The handler swaps NOTHING: `inside` is `mp.left`, `outside` is
   * `mp.right`, on both sides (measured on the book 2026-08-15). If a swap
   * were added here too, the composition would become IDENTITY — the
   * mirroring would vanish, while both comments would keep promising it.
   * That's exactly what happened before 2026-08-15, and the test below
   * (`typeArea` on both sides) exists precisely so it doesn't come back. */
  const leftMargin = page.side === "left" ? page.margins.outside : page.margins.inside;
  const rightMargin = page.side === "left" ? page.margins.inside : page.margins.outside;
  return [
    page.margins.top,
    leftMargin,
    page.height - page.margins.bottom,
    page.width - rightMargin,
  ];
}

/** The sheet itself. */
export function pageBox(page: PageMeasure): Bounds {
  return [0, 0, page.height, page.width];
}

/**
 * Bleed box. The bleed on the INNER (spine) side is zero in the book
 * (measured H13), so a full-bleed plate that reaches exactly to the spine
 * doesn't become a finding.
 */
export function bleedBox(page: PageMeasure): Bounds {
  const leftBleed = page.side === "left" ? page.bleed.outside : page.bleed.inside;
  const rightBleed = page.side === "left" ? page.bleed.inside : page.bleed.outside;
  return [
    -page.bleed.top,
    -leftBleed,
    page.height + page.bleed.bottom,
    page.width + rightBleed,
  ];
}

/**
 * Vertical column boundaries. One column gives two boundaries (the left and
 * right edges of the type area); N columns give 2N boundaries accounting for
 * the gutter.
 */
export function columnEdges(page: PageMeasure): number[] {
  const area = typeArea(page);
  const x1 = area[1];
  const x2 = area[3];
  const n = Math.max(1, page.margins.columnCount);
  if (n === 1) return [x1, x2];

  const gutter = page.margins.columnGutter;
  const colWidth = (x2 - x1 - gutter * (n - 1)) / n;
  const edges: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = x1 + i * (colWidth + gutter);
    edges.push(start, start + colWidth);
  }
  return edges;
}

/**
 * All boundaries worth checking a miss against, deduplicated and ordered.
 *
 * Duplicates are removed deliberately: with a single column, the column
 * boundaries coincide with the type-area boundaries, and without
 * deduplication the same miss would be counted twice.
 */
export function referenceEdges(page: PageMeasure): {
  horizontal: number[];
  vertical: number[];
} {
  const area = typeArea(page);
  const box = pageBox(page);
  const bleed = bleedBox(page);

  const horizontal = dedupe([area[0], area[2], box[0], box[2], bleed[0], bleed[2]]);
  const vertical = dedupe([area[1], area[3], box[1], box[3], bleed[1], bleed[3], ...columnEdges(page)]);
  return { horizontal, vertical };
}

function dedupe(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    /* If `out` is empty, add the first boundary.
     * If not empty, add only if the difference from the last boundary > EPSILON.
     * `out.at(-1)!` always has a value here, because `out.length > 0`. */
    const last = out.at(-1);
    if (out.length === 0 || (last !== undefined && Math.abs(last - v) > EPSILON)) {
      out.push(v);
    }
  }
  return out;
}
