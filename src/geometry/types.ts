/**
 * Geometry-measurement types. A LEAF MODULE: it imports nothing from
 * `src/geometry/`, so the families can depend on it without forming a cycle
 * (a lesson from Phase 12, where the comparator had to be moved for exactly
 * this reason).
 */

/**
 * The coordinate-comparison epsilon, in points.
 *
 * NOT "tidiness" — an InDesign requirement: `page.bounds` for the very same
 * page yields 17 different signatures instead of two, with discrepancies up
 * to 7.3e-12 (measurement H13). Comparing geometry without an epsilon is
 * impossible in principle.
 */
export const EPSILON = 0.001;

export type Family = "frame" | "image" | "anchored" | "wrap";

/**
 * A value in points, for grouping and for display.
 *
 * `toFixed(2)` displayed a 0.003 pt miss as `"0.00 pt"` — i.e. a number that
 * reads exactly as "no miss", even though the detector had just found it and
 * placed it among the findings. And EPSILON = 0.001, so the entire
 * 0.001…0.005 range collapsed to zero — and that's exactly the densest
 * range: on the book, 44 of 46 elements sit under 0.1 pt.
 *
 * Below a hundredth — four digits (zero becomes impossible, since
 * EPSILON = 0.001); from a hundredth up — two digits: 11.3386 pt with four
 * digits on every report line would be noise, not precision.
 */
export function formatPt(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(2);
}

export type PageSide = "left" | "right" | "single";

/** Bounding box in points, in the ITEM'S OWN PAGE space: [y1, x1, y2, x2]. */
export type Bounds = [number, number, number, number];

export interface GraphicMeasure {
  /**
   * `raster` — has a ppi; `vector` — does NOT, by construction (PDF/.ai
   * throws on `effectivePpi`, measured H13); `unknown` — the type wasn't
   * recognized.
   */
  kind: "raster" | "vector" | "unknown";
  /** `null` for a vector is a PROPERTY, not a missing measurement. */
  effectivePpi: [number, number] | null;
  actualPpi: [number, number] | null;
  space: string | null;
  hScale: number;
  vScale: number;
  linkName: string | null;
  linkStatus: string | null;
}

export interface ItemMeasure {
  itemId: number;
  page: string;
  side: PageSide;
  /** Constructor name: TextFrame, GraphicLine, Rectangle, Group, Image, PDF… */
  type: string;
  parentKind: string;
  anchored: boolean;
  inGroup: boolean;
  layer: string;
  layerVisible: boolean;
  layerPrintable: boolean;
  locked: boolean;
  /** Degrees. On the book, 91 frames have −90 (all the folios). */
  rotation: number;
  bounds: Bounds;
  /** `null` if the type doesn't support text wrap. */
  wrapMode: string | null;
  /**
   * Wrap offsets [top, left, bottom, right] in points; `null` if the type
   * doesn't support text wrap or reading it failed. `null` is a PROPERTY,
   * not a missing measurement.
   */
  wrapOffsets: [number, number, number, number] | null;
  /** Paragraph style of the anchored frame's first paragraph; `null` for non-text. */
  anchorStyle: string | null;
  graphic: GraphicMeasure | null;
}

export interface PageMeasure {
  name: string;
  side: PageSide;
  width: number;
  height: number;
  margins: {
    top: number;
    bottom: number;
    /**
     * `inside` — `marginPreferences.left`, `outside` — `.right`, WITH NO swap
     * on verso: measured on the book 2026-08-15, InDesign keeps left as the
     * inside margin on BOTH sides (zero counterexamples across 196 pages).
     * The mirroring — i.e. the fact that inside on verso sits ON THE RIGHT —
     * is done in exactly one place: `typeArea()` in `reference.ts`.
     */
    inside: number;
    outside: number;
    columnCount: number;
    columnGutter: number;
  };
  bleed: { top: number; bottom: number; inside: number; outside: number };
}

export interface GeometryMeasure {
  docName: string;
  units: "points";
  traversal: "page.allPageItems";
  /**
   * COORDINATE SOURCE. `geometricBounds` silently returns different numbers
   * in a document whose ruler zero has been moved, and no check would
   * notice — the risk is named directly in
   * `docs/measured-facts-phase13.md`. So both properties are read and land
   * in `measuredWith`: a response taken from a non-standard coordinate
   * origin must say so itself, rather than look like an ordinary one.
   */
  rulerOrigin: string;
  zeroPoint: [number, number];
  ms: number;
  pages: PageMeasure[];
  items: ItemMeasure[];
}

export interface GeometryFinding {
  family: Family;
  defect: string;
  /** Pages where the finding occurs. Ordered by comparePageNames. */
  pages: string[];
  /**
   * How many pages there were BEFORE the list was truncated. Present only
   * when truncation actually happened: a silently shortened list would read
   * as complete, and that's exactly the flaw that once took Phase 4 down
   * with 78 KB.
   */
  pagesTotal?: number;
  count: number;
  /** The value findings are grouped by (miss magnitude, ppi, mode…). */
  value: string;
  detail?: string;
}

/**
 * Page order by NUMBER, not by string.
 *
 * Phase 9 debt, closed across three families: truncating a list makes its
 * order load-bearing, and the small "not sorted" detail, harmless before
 * truncation, becomes a flaw after it.
 */
export function comparePageNames(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
