/**
 * The `frame` family.
 *
 * WHAT'S NOT HERE AND WHY. There's no “element outside the type area” detector: measurement
 * H13 found 602 such elements out of 965 and zero defects among them. The question number
 * hangs in the margin per the edition's canonical rule, the folio sits in the bottom
 * margin, a full-bleed plate runs out to the full bleed. A detector would be
 * formally right and practically harmful.
 *
 * There's also no “elements touch” detector: 421 findings across 118 of 196
 * pages, with seven significant. A significant touch is a touch between DIFFERENT ROLES, and
 * geometry doesn't know roles. It's in the backlog as a question, not as deferred implementation.
 *
 * WHAT'S LEFT — near miss: an element that falls short of a reference boundary
 * (or crosses it) by less than the threshold. The measurement's distribution shows a
 * natural gap: 46 elements under 1 pt, of which 44 under 0.1 pt, and then
 * nothing all the way to 10 pt.
 */
import { bleedBox, referenceEdges } from "./reference.js";
import {
  type Bounds,
  comparePageNames,
  EPSILON,
  formatPt,
  type GeometryFinding,
  type ItemMeasure,
  type PageMeasure,
} from "./types.js";

/** The nearest reference boundary to a single coordinate number, in points. */
function nearestEdge(value: number, edges: number[]): number {
  let best: number | undefined;
  for (const edge of edges) {
    const d = Math.abs(value - edge);
    if (best === undefined || d < best) best = d;
  }
  /* `referenceEdges()` always returns non-empty arrays (the type area and the sheet
   * always exist), so `undefined` here is a sign of a broken call, not a normal
   * case. */
  if (best === undefined) throw new Error("referenceEdges() returned an empty list of edges");
  return best;
}

/**
 * The element's nearest miss past any reference boundary, in points.
 *
 * Computed SEPARATELY for each of the four sides of the bounding box (top, bottom, left,
 * right), rather than as a single minimum across all eight candidates at once: a frame that
 * coincides with the boundary on three sides and misses on the fourth would give a
 * global minimum of 0 (from the coinciding sides), and that zero would mask the
 * real miss on the fourth side. So each side is first
 * checked for its own alignment (≤ EPSILON — a coincidence, not a miss), and
 * only among the sides that are NOT aligned is the smallest gap sought.
 */
function closestMiss(item: ItemMeasure, page: PageMeasure): number | null {
  const edges = referenceEdges(page);
  const perSide = [
    nearestEdge(item.bounds[1], edges.vertical), // left side
    nearestEdge(item.bounds[3], edges.vertical), // right side
    nearestEdge(item.bounds[0], edges.horizontal), // top side
    nearestEdge(item.bounds[2], edges.horizontal), // bottom side
  ];

  let best: number | null = null;
  for (const d of perSide) {
    if (d <= EPSILON) continue; // the side is aligned — that's a coincidence, not a miss
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Near misses, grouped by magnitude.
 *
 * `thresholdPt` — A PARAMETER WITH NO DEFAULT. The gap in this book's layout
 * falls between 1 and 10 pt, but that's a property of THIS document: an edition with a different
 * type size will have the gap sit elsewhere. A default would turn a constant of this
 * particular layout into the tool's behavior.
 */
export function detectNearMiss(
  items: ItemMeasure[],
  pages: PageMeasure[],
  thresholdPt: number,
): GeometryFinding[] {
  const byPage = new Map(pages.map((p) => [p.name, p]));
  /* The key is the miss magnitude, rounded to the hundredth: identical misses on different
   * pages must produce ONE row. On the book, collapsing identical
   * findings shrank 33 437 B → 733 B (Phase 6). */
  const groups = new Map<string, { pages: string[]; count: number }>();

  for (const item of items) {
    /* A rotated frame: geometricBounds is an axis-oriented bounding box, not the
     * frame itself. Alignment can't be judged from it. 91 elements in the book. */
    if (item.rotation !== 0) continue;

    const page = byPage.get(item.page);
    if (page === undefined) continue;

    const miss = closestMiss(item, page);
    if (miss === null) continue;
    /* A miss smaller than epsilon is InDesign's own double-precision error
     * (up to 7.3e-12 measured), not the layout artist's miss. */
    if (miss <= EPSILON) continue;
    if (miss >= thresholdPt) continue;

    const key = formatPt(miss);
    const g = groups.get(key) ?? { pages: [], count: 0 };
    g.count += 1;
    if (!g.pages.includes(item.page)) g.pages.push(item.page);
    groups.set(key, g);
  }

  const out: GeometryFinding[] = [];
  for (const [value, g] of groups) {
    out.push({
      family: "frame",
      defect: "frame-near-miss",
      pages: [...g.pages].sort(comparePageNames),
      count: g.count,
      value: `${value} pt`,
      detail: "The element nearly aligns with the reference edge, but does not.",
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Survey mode: a breakdown of misses by magnitude, without a verdict.
 *
 * The same mechanism as `spacingMode: "survey"` in `composition_audit`: the threshold
 * can't be derived from the document, so the user looks at the distribution in
 * their own edition and names the number themselves.
 */
export function surveyNearMiss(
  items: ItemMeasure[],
  pages: PageMeasure[],
): { bucket: string; count: number }[] {
  const byPage = new Map(pages.map((p) => [p.name, p]));
  const buckets = [
    { bucket: "≤0.01", limit: 0.01, count: 0 },
    { bucket: "≤0.1", limit: 0.1, count: 0 },
    { bucket: "≤1", limit: 1, count: 0 },
    { bucket: "≤3", limit: 3, count: 0 },
    { bucket: "≤10", limit: 10, count: 0 },
    { bucket: ">10", limit: Infinity, count: 0 },
  ];

  for (const item of items) {
    if (item.rotation !== 0) continue;
    const page = byPage.get(item.page);
    if (page === undefined) continue;
    const miss = closestMiss(item, page);
    if (miss === null || miss <= EPSILON) continue;
    for (const b of buckets) {
      if (miss <= b.limit) {
        b.count += 1;
        break;
      }
    }
  }
  return buckets.map(({ bucket, count }) => ({ bucket, count }));
}

/**
 * The element goes past the bleed DECLARED in the document.
 *
 * The reference is the document's own `documentBleed*Offset`, not a number. Which is exactly why
 * the full-bleed plate on p. 96 of the working book (bleed exactly 8.50393700787402 on
 * three sides) does NOT become a finding, and the book has only 14 such elements total —
 * a population that's workable, unlike 602.
 */
/**
 * Parent types that CROP their content.
 *
 * MEASURED ON THE BOOK 2026-08-16: `page.allPageItems` returns a placed
 * image as a SEPARATE element alongside the frame holding it — across the
 * whole book, «Image ← Rectangle» × 4 and «PDF ← Rectangle» × 2. That element's bounds
 * are the UNCROPPED original, while only the portion inside the frame
 * makes it onto the sheet.
 *
 * A group is NOT in the list, and that's a measurement, not a taste call: a group doesn't crop
 * its content — «TextFrame ← Group» occurs 38 times in the book, and all of them are correctly
 * judged by their own bounds. Anchored items (parent is text) also stay: the anchor
 * determines WHERE the frame sits, not how much it's cropped.
 */
const CROPPING_PARENTS = new Set(["Rectangle", "Oval", "Polygon", "TextFrame", "GraphicLine"]);

/**
 * Whether the element is the CONTENT of another frame, i.e. whether its parent crops it.
 *
 * A shared gate for both bleed detectors: judging an uncropped original against
 * the page boundary means reporting on something that won't be on the sheet.
 * The cost of the error was measured — four images in the working book (p. 2, 20, 96,
 * 128) were getting `frame-off-page` at 34-74 pt, while their FRAMES sit
 * exactly on the bleed boundary.
 */
function isCroppedByContainer(item: ItemMeasure): boolean {
  return CROPPING_PARENTS.has(item.parentKind);
}

export function detectOffPage(items: ItemMeasure[], pages: PageMeasure[]): GeometryFinding[] {
  const byPage = new Map(pages.map((p) => [p.name, p]));
  const groups = new Map<string, { pages: string[]; count: number }>();

  for (const item of items) {
    if (isCroppedByContainer(item)) continue;
    /*
     * ЩО НЕ ДРУКУЄТЬСЯ, ТЕ НЕ МОЖЕ ЗІЙТИ З АРКУША.
     *
     * `layerVisible`/`layerPrintable` міряються, але їх читав рівно один
     * детектор — `wrap.ts`. Тож напрямна на схованому шарі, накреслена за
     * виліт, давала frame-off-page про об'єкт, якого на аркуші не буде.
     * `color_audit` тримає протилежну політику з ВИМІРЯНИМ обґрунтуванням
     * (`src/color/types.ts`: вісім елементів форзаца в 100 % ціану на
     * непринтованому шарі, «детектор без цього поля дав би вісім порушень на
     * правильно зібраному файлі»), і саме її тут і бракувало.
     */
    if (!item.layerVisible || !item.layerPrintable) continue;

    /*
     * ROTATED FRAMES ARE INCLUDED HERE — and that's a choice, not an oversight (branch
     * review, I3). detectNearMiss excludes them, and it looked as though one
     * detector trusts a number the other one had declared unfit.
     *
     * The difference is WHAT EXACTLY is taken from the bounds. MEASURED 2026-08-15:
     * a 300×40 rectangle rotated 45° gives geometricBounds of
     * 240.4163×240.4163 — exactly (300+40)/√2, and exactly visibleBounds. So
     * a rotated element's geometricBounds is a TIGHT axis-oriented envelope
     * of the rotated shape.
     *
     *   alignment: the envelope's SIDES are not the frame's sides, so the question of
     *     whether the frame's edge meets the column's edge can't be decided from it → gate it out;
     *   bleed overrun: the envelope is tight, so it crosses the bleed boundary
     *     IF AND ONLY IF some corner of the frame itself goes past it →
     *     the verdict is exact, gating it out would lose genuine findings.
     *
     * This is spelled out in the report's notMeasured too (report.ts), so the answer doesn't
     * sound like it's contradicting itself.
     */
    const page = byPage.get(item.page);
    if (page === undefined) continue;
    const box = bleedBox(page);

    const over = Math.max(
      box[0] - item.bounds[0],
      box[1] - item.bounds[1],
      item.bounds[2] - box[2],
      item.bounds[3] - box[3],
    );
    if (over <= EPSILON) continue;

    const key = formatPt(over);
    const g = groups.get(key) ?? { pages: [], count: 0 };
    g.count += 1;
    if (!g.pages.includes(item.page)) g.pages.push(item.page);
    groups.set(key, g);
  }

  const out: GeometryFinding[] = [];
  for (const [value, g] of groups) {
    out.push({
      family: "frame",
      defect: "frame-off-page",
      pages: [...g.pages].sort(comparePageNames),
      count: g.count,
      value: `${value} pt`,
      detail: "The element goes past the bleed declared by the document.",
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * BLEED FALLS SHORT: the element crosses the TRIM line but doesn't reach
 * the BLEED line.
 *
 * The question is the opposite of `frame-off-page`, and it's this one that's useful — it was raised by the
 * user on 2026-08-16. Going PAST the bleed is harmless: the excess just gets trimmed off.
 * But an element that will be cut and falls short of the bleed
 * leaves a WHITE STRIPE along the sheet's edge the moment the cutter is off by even a little. That's
 * a genuine print defect.
 *
 * WHY “CROSSES THE TRIM” SPECIFICALLY — it's a sign of intent. Not every
 * element is supposed to fill the bleed, only the ones that reach the sheet's edge; the rest never
 * claim the edges at all. Crossing the trim line is the only sign of that intent
 * available from geometry, and it's taken from the document, not from a constant.
 *
 * NO THRESHOLD, AND NONE NEEDED: falling short is a fact (the reference is the document
 * itself), not a judgment call. `EPSILON` here is only against double-precision noise.
 *
 * A side with ZERO bleed (the inner edge on a spread) produces no findings
 * by construction: the bleed line coincides with the trim there, so there's nowhere
 * to fall short of.
 */
export function detectBleedShort(items: ItemMeasure[], pages: PageMeasure[]): GeometryFinding[] {
  const byPage = new Map(pages.map((p) => [p.name, p]));
  const groups = new Map<string, { pages: string[]; count: number }>();

  for (const item of items) {
    if (isCroppedByContainer(item)) continue;
    /*
     * ЩО НЕ ДРУКУЄТЬСЯ, ТЕ НЕ МОЖЕ ЗІЙТИ З АРКУША.
     *
     * `layerVisible`/`layerPrintable` міряються, але їх читав рівно один
     * детектор — `wrap.ts`. Тож напрямна на схованому шарі, накреслена за
     * виліт, давала frame-off-page про об'єкт, якого на аркуші не буде.
     * `color_audit` тримає протилежну політику з ВИМІРЯНИМ обґрунтуванням
     * (`src/color/types.ts`: вісім елементів форзаца в 100 % ціану на
     * непринтованому шарі, «детектор без цього поля дав би вісім порушень на
     * правильно зібраному файлі»), і саме її тут і бракувало.
     */
    if (!item.layerVisible || !item.layerPrintable) continue;

    const page = byPage.get(item.page);
    if (page === undefined) continue;
    const bleed = bleedBox(page);
    const trim: Bounds = [0, 0, page.height, page.width];

    /*
     * Per side, separately: crossed the trim (i.e. claims the edge) and
     * didn't reach the bleed. The sign of the difference is different on each side, hence
     * four expressions rather than a loop over indices — mixing up sides here would cost
     * a wrong verdict, and that's exactly what the tests' asymmetric fixture catches.
     */
    const shortfalls = [
      item.bounds[0] < trim[0] - EPSILON ? item.bounds[0] - bleed[0] : 0,
      item.bounds[1] < trim[1] - EPSILON ? item.bounds[1] - bleed[1] : 0,
      item.bounds[2] > trim[2] + EPSILON ? bleed[2] - item.bounds[2] : 0,
      item.bounds[3] > trim[3] + EPSILON ? bleed[3] - item.bounds[3] : 0,
    ];
    const worst = Math.max(...shortfalls);
    if (worst <= EPSILON) continue;

    const key = formatPt(worst);
    const g = groups.get(key) ?? { pages: [], count: 0 };
    g.count += 1;
    if (!g.pages.includes(item.page)) g.pages.push(item.page);
    groups.set(key, g);
  }

  const out: GeometryFinding[] = [];
  for (const [value, g] of groups) {
    out.push({
      family: "frame",
      defect: "bleed-short",
      pages: [...g.pages].sort(comparePageNames),
      count: g.count,
      value: `${value} pt`,
      detail:
        "The element crosses the trim line but falls short of the bleed — " +
        "a trimmer with tolerance error will leave a white sliver along the edge.",
    });
  }
  return out.sort((a, b) => b.count - a.count);
}
