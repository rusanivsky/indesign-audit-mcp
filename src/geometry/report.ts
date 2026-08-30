/**
 * Report for `geometry_audit`.
 *
 * The row unit is DEFECT CLASS × VALUE GROUP, not an element. The book has 965
 * elements; a per-element report would knock the tool out the same way 78 KB
 * once did in Phase 4. Aggregating identical findings already took Phase 6
 * from 33,437 B → 733 B.
 */
import type { AnchoredPopulation } from "./anchored.js";
import type { GraphicRow } from "./image.js";
import type { Family, GeometryFinding, GeometryMeasure } from "./types.js";

/**
 * Ceiling for detail rows.
 *
 * The number is NOT round and NOT "with margin": the Phase 5 rule is that a
 * threshold taken from a ceiling instead of a measurement is vacuous, and
 * that happened twice in a single phase. The value is confirmed by measuring
 * response size in Task 12 and, if the measurement says otherwise, changes
 * TOGETHER with the entry in the measured facts.
 */
export const MAX_DETAIL_ROWS = 60;

/**
 * Ceiling for the PAGE LIST inside a single row — a finding or an inventory.
 *
 * Truncating the rows themselves (`MAX_DETAIL_ROWS`) didn't protect against a
 * second, unnoticed source of size: ONE row can carry hundreds of page names.
 * On the working book the «Нумерація питань» population is 185 anchored
 * items, and a single defect-class finding unfolds into dozens of pages.
 * That's exactly how Phase 4 once produced 78 KB and knocked the tool out.
 *
 * A truncated list is ALWAYS accompanied by `pagesTotal`: a silently
 * shortened list would read as complete.
 */
export const MAX_PAGES_PER_ROW = 25;

/**
 * Ceiling for `anchored` inventory ROWS.
 *
 * A row is a pair «paragraph style × constructor type», and until now it was
 * the ONLY place in the response with no upper bound at all: only the page
 * lists INSIDE a row were truncated, while the number of rows themselves
 * could be unbounded. Measured (synthetic maximal report with all ceilings
 * filled):
 *
 *      4 rows (as in the book)  →  68 485 B
 *     20 rows                   →  78 991 B
 *     60 rows                   → 105 271 B
 *    500 rows                   → 394 751 B
 *
 * ~657 B per row, linear and unbounded — i.e. the same failure class that
 * once knocked Phase 4 out with 78 KB.
 *
 * WHERE THE NUMBER 18 COMES FROM. Not a round number or "with margin": it's
 * the LARGEST ceiling at which the pathological case stays under 78 000 B,
 * i.e. under the size that has historically broken the tool:
 * 68 485 + (18 − 4) × 657 ≈ 77 683 B. From below it's held by the book
 * measurement — there are FOUR populations there (185 «Нумерація питань»,
 * 35 «Зміст Номер сторінки», 82 unstyled GraphicLine, plus a fourth
 * «style × type» pair), so 18 leaves the real edition a 4.5x margin.
 *
 * Changes TOGETHER with the measurement in `docs/measured-facts-phase13.md`,
 * never separately.
 */
export const MAX_ANCHORED_ROWS = 18;

/** Inventories as supplied by the caller — without the fields the report computes itself. */
export interface GeometryInventoryInput {
  anchored: AnchoredPopulation[];
  graphics: GraphicRow[];
  wrap: { mode: string; count: number }[];
}

export interface GeometryInventory extends GeometryInventoryInput {
  /** Non-`null` only when `graphics` was actually truncated. */
  graphicsTruncated: { shown: number; total: number } | null;
  /**
   * Non-`null` only when `anchored` was actually truncated.
   *
   * Silent truncation here is worse than a large response: the inventory is a
   * claim about the document's COMPOSITION, and a population list shortened
   * without warning would read as «there are no other anchored objects in
   * the book».
   */
  anchoredTruncated: { shown: number; total: number } | null;
}

export interface GeometryReport {
  docName: string;
  measuredWith: {
    traversal: string;
    units: string;
    /**
     * WHAT DEFINES THE COORDINATE ZERO. Without this, `measuredWith` named
     * the traversal, units, counters and milliseconds — but not the source of
     * the numbers themselves, and `geometricBounds` in a document with a
     * moved ruler zero silently returns different coordinates.
     */
    coordinateOrigin: { rulerOrigin: string; zeroPoint: [number, number] };
    itemsSeen: number;
    pagesSeen: number;
    ms: number;
  };
  findings: GeometryFinding[];
  truncated: { shown: number; total: number } | null;
  inventory: GeometryInventory;
  /** Breakdown of misses when no threshold was named; otherwise `null`. */
  survey: { bucket: string; count: number }[] | null;
  notMeasured: string[];
  caveats: string[];
}

/**
 * A copy of the row with a truncated page list.
 *
 * A COPY specifically: inventory rows come from the caller's live
 * computations, and silently mutating its data would make a repeat call on
 * the same measurement non-reproducible.
 */
function capPages<T extends { pages: string[]; pagesTotal?: number }>(row: T): T {
  if (row.pages.length <= MAX_PAGES_PER_ROW) return { ...row };
  return {
    ...row,
    pages: row.pages.slice(0, MAX_PAGES_PER_ROW),
    pagesTotal: row.pages.length,
  };
}

/**
 * Families for which the document may provide no MATERIAL FOR A VERDICT —
 * «no material», not «not checked». `frame` is not included here: page
 * items for frame geometry exist by construction as long as the document has
 * any items at all.
 *
 * «Material for a verdict» ≠ «inventory non-empty» (Task 12 fix round 2,
 * review): for `anchored`/`image` these are the same thing (their
 * inventories include ONLY items that have already passed classification),
 * but NOT for `wrap` — `inventoryWrap()` also counts `NONE` entries, so it
 * can be non-empty while containing no material for a verdict at all (the
 * state of the working book). The emptiness criterion for each family is
 * computed by the caller (`src/tools/geometry.ts`) from the corresponding
 * measurement instrument, not by this module.
 */
export type PopulationFamily = "anchored" | "image" | "wrap";

/**
 * Text of the `notMeasured` row for an empty population — one per family,
 * because the reason for emptiness and its consequence for the verdict
 * differ per family.
 */
const EMPTY_POPULATION_TEXT: Record<PopulationFamily, string> = {
  anchored:
    "There are no anchored objects in the document: the anchored inventory is empty. " +
    "This is a property of the document, not a missed measurement — there's nothing " +
    "to judge anchor alignment against.",
  image:
    "There are no graphics in the document: the image inventory is empty. Resolution and " +
    "links have nothing to check against — this is a property of the document, not a measurement gap.",
  wrap:
    "Text wrap isn't applied to any element in the document (all are NONE " +
    "or an unsupported type): the wrap family had nothing to judge. This isn't a 'field " +
    "that didn't read' (the tool sees the elements correctly), it's a property " +
    "of the document — and that's exactly why staying silent here would read as 'checked, clean'.",
};

export interface ReportOptions {
  /**
   * Which families the user ACTUALLY asked for.
   *
   * Without this, a response to `families: ["frame"]` would carry all three
   * inventories anyway and would equally claim in `notMeasured` that
   * anchored/image/wrap were not judged for lack of a parameter — for
   * families nobody asked about. This is not a formatting nitpick:
   * `notMeasured` is a promise about the LIMITS OF THE MEASUREMENT, and a row
   * about a measurement not performed where no measurement was requested
   * makes that promise false.
   *
   * No defaulting: the caller knows what it asked for.
   */
  families: Family[];
  /** How many returned frames are excluded from the alignment verdict. */
  rotatedExcluded: number;
  /** Скільки елементів не дали прочитати `geometricBounds` — див. tools/geometry.ts. */
  unreadableBounds?: number;
  /** Whether the user named a geometric anchor rule. */
  anchorRuleNamed?: boolean;
  /** Whether the user named a resolution threshold. */
  resolutionThresholdNamed?: boolean;
  /**
   * How many of the document's graphic elements are vector. A vector has no
   * `effectivePpi`/`actualPpi`/`space` BY CONSTRUCTION (PDF/.ai throws on
   * access, measured H13) — that's a PROPERTY, not a missed measurement, and
   * silence about it would read as «checked, clean».
   */
  vectorGraphicsCount?: number;
  /**
   * Families whose inventory in THIS document is empty (measured, not
   * assumed). An empty inventory means «nothing to judge on», not «zero
   * findings»; spec §8 forbids merging these two states through silence.
   */
  emptyPopulations?: PopulationFamily[];
  /**
   * Family inventories. Part of the RESPONSE, not an addendum to it: while
   * they lived alongside the report (`ok({ ...report, inventory, survey })`),
   * the size measurement was measuring something other than what the tool
   * actually returns — `inventory` and `survey` weren't weighed at all, and
   * the threshold was derived from an incomplete payload.
   */
  inventory: GeometryInventoryInput;
  /** Breakdown of misses when no threshold was named; otherwise `null`. */
  survey?: { bucket: string; count: number }[] | null;
}

export function buildReport(
  measure: GeometryMeasure,
  findings: GeometryFinding[],
  options: ReportOptions,
): GeometryReport {
  const notMeasured: string[] = [];
  const wants = new Set(options.families);

  /*
   * MASTER-PAGE ITEMS — a limitation of the MEASUREMENT INSTRUMENT ITSELF, so
   * the row is unconditional, independent of both families and options.
   *
   * `page.allPageItems` doesn't see un-overridden master-page items —
   * measured by this same repository (`src/jsx/pagination.jsx`, probe H7:
   * `page.textFrames` returned zero out of 50 folios, because all of them
   * lived on the master). Spec §2 promises `fromMaster` provenance, and it
   * exists nowhere. Phase 10 happened exactly because this blind spot was
   * once read as «clean» — which is why it's named here, not omitted.
   */
  notMeasured.push(
    "Master-page elements are NOT included in the measurement: the page.allPageItems walk sees " +
      "only what sits on the page itself, and unoverridden master-page " +
      "elements are invisible to it (measured by this repository — " +
      "Phase 10's H7 probe: 50 folios gave zero). This is a property of the TOOL, " +
      "not the document: staying silent about them would read as 'checked, clean'.",
  );

  if (wants.has("frame")) {
    if (options.rotatedExcluded > 0) {
      notMeasured.push(
        `ALIGNMENT of ${options.rotatedExcluded} rotated frame(s) was not checked: ` +
          "for a rotated element, geometricBounds returns an axis-aligned bounding box, " +
          "not the frame itself, so its SIDES aren't the frame's sides. " +
          "BLEED OVERRUN for these same frames, however, IS judged, and judged " +
          "correctly: the bounding box is a tight axis-aligned envelope of the rotated " +
          "shape (measured 2026-08-15: a 300×40 rectangle rotated 45°, " +
          "gives 240.4163×240.4163 = (300+40)/√2), so the envelope crosses the bleed " +
          "exactly when some corner of the frame does.",
      );
    }
  }
  if (wants.has("anchored") && options.anchorRuleNamed === false) {
    notMeasured.push(
      "Anchored-object geometry was not checked: no rule was named. " +
        "The tool has no built-in notion of where an anchor should sit — " +
        "that's a property of the publication, and the user sets it.",
    );
  }
  if (wants.has("image")) {
    if (options.resolutionThresholdNamed === false) {
      notMeasured.push(
        "Image resolution was not assessed: no threshold was named. " +
          "300 ppi for offset and 150 for digital is the printer's decision, not the tool's.",
      );
    }
    if (options.vectorGraphicsCount !== undefined && options.vectorGraphicsCount > 0) {
      notMeasured.push(
        `Resolution of ${options.vectorGraphicsCount} vector image(s) was not assessed and ` +
          "could not be assessed: a vector has no ppi BY CONSTRUCTION (PDF/.ai has no " +
          "effectivePpi/actualPpi — accessing them throws), not because the measurement missed something.",
      );
    }
  }
  for (const family of options.emptyPopulations ?? []) {
    /* An empty population for a family nobody asked about is not a
     * measurement limit, just not its turn. */
    if (!wants.has(family)) continue;
    notMeasured.push(EMPTY_POPULATION_TEXT[family]);
  }

  /*
   * A permanent tool limitation, not a consequence of a missing call
   * parameter: wrap.ts (Task 10b) deliberately does NOT implement a third
   * family detector — «wrap on an element that nothing actually wraps» —
   * because bounding-box intersection doesn't mean text actually reaches the
   * object (the flow may route around it via frame threading, the frame may
   * be empty, the object may sit in a column the text doesn't occupy).
   * wrap.ts promises this limitation will be named right here, independent
   * of other options — but only when the wrap family was ACTUALLY requested:
   * the limitation of an unimplemented detector for a family that wasn't
   * counted is not a limitation of this response.
   */
  if (wants.has("wrap")) {
    notMeasured.push(
      "The 'wrap on an element nothing wraps around' detector isn't implemented: " +
        "a bounding-box overlap doesn't mean text actually reaches the object — " +
        "the text flow can route around it through frame threading, the frame can be " +
        "empty, or the object can sit in a column the text doesn't occupy. A reliable " +
        "answer needs knowledge of text flow that geometry alone doesn't give.",
    );
  }

  const caveats = [
    "'Element outside the type area' is NOT a defect: on the real edition 62% " +
      "of elements sit outside the type area on purpose (running-head page numbers, folios, " +
      "full-bleed blocks). The tool reports a NEAR MISS, not an overrun.",
    "Touching and overlapping elements aren't reported: in a grid layout, adjacent " +
      "frames share a boundary exactly, and on the real edition that's 118 of 196 pages.",
    "The measurement doesn't see text in tables and footnotes — the same limit as in styles_audit.",
  ];

  /* A non-standard coordinate origin is neither an error nor a reason to
   * stay silent, but a condition under which the numbers read differently.
   * Hence a caveat, not notMeasured: the measurement happened, its frame of
   * reference just isn't the one the reader expects. */
  if ((options.unreadableBounds ?? 0) > 0) {
    notMeasured.push(
      `${String(options.unreadableBounds)} element(s) did not yield geometricBounds and were ` +
        "EXCLUDED from every family: their position is unknown. They are not counted as clean — " +
        "a zero rectangle would have answered “where is the frame” with numbers nobody measured.",
    );
  }
  if (measure.rulerOrigin !== "PAGE_ORIGIN") {
    /*
     * ТЕПЕР ЦЕ ПОВІДОМЛЕННЯ, А НЕ ЗАСТЕРЕЖЕННЯ ПРО ЗСУВ.
     *
     * Доти текст казав, що «кожне число зсунуте від звичного кута сторінки», і
     * применшував: зсунутими були числа лише на ПРАВІЙ сторінці розвороту (на
     * цілу ширину сторінки), а на лівій — ні. Тобто відповідь була сумішшю
     * правдивих і вигаданих знахідок, а не рівномірно зміщеною.
     *
     * `geometry_measure` тепер зводить рамки до початку САМОЇ СТОРІНКИ
     * (`p.bounds`), тож положення лінійки на числа не впливає. Факт лишається
     * у відповіді, бо він пояснює, чому числа тут і в InDesign на екрані
     * різні, — але це вже не хиба виміру.
     */
    caveats.push(
      `The document's ruler zero is ${measure.rulerOrigin}, not PAGE_ORIGIN. ` +
        "The numbers below are NOT affected: every frame is reduced to its own page's " +
        "origin during the measurement, so the ruler's position cannot shift them. " +
        "It is reported because coordinates shown in InDesign itself will differ from " +
        "these by the ruler offset.",
    );
  }
  if (measure.zeroPoint[0] !== 0 || measure.zeroPoint[1] !== 0) {
    caveats.push(
      `The document's zero point has been moved to [${measure.zeroPoint[0]}, ${measure.zeroPoint[1]}] ` +
        "(not [0, 0]): every coordinate in the response is measured from it.",
    );
  }

  const total = findings.length;
  const shown = findings.slice(0, MAX_DETAIL_ROWS).map(capPages);

  const graphicsTotal = options.inventory.graphics.length;
  const anchoredTotal = options.inventory.anchored.length;

  return {
    docName: measure.docName,
    measuredWith: {
      traversal: measure.traversal,
      units: measure.units,
      coordinateOrigin: {
        rulerOrigin: measure.rulerOrigin,
        zeroPoint: measure.zeroPoint,
      },
      itemsSeen: measure.items.length,
      pagesSeen: measure.pages.length,
      ms: measure.ms,
    },
    findings: shown,
    truncated: total > MAX_DETAIL_ROWS ? { shown: MAX_DETAIL_ROWS, total } : null,
    inventory: {
      /* Slice the rows first, then truncate pages in the ones that remain:
       * the reverse order would needlessly copy hundreds of discarded rows. */
      anchored: options.inventory.anchored.slice(0, MAX_ANCHORED_ROWS).map(capPages),
      anchoredTruncated:
        anchoredTotal > MAX_ANCHORED_ROWS
          ? { shown: MAX_ANCHORED_ROWS, total: anchoredTotal }
          : null,
      graphics: options.inventory.graphics.slice(0, MAX_DETAIL_ROWS),
      graphicsTruncated:
        graphicsTotal > MAX_DETAIL_ROWS
          ? { shown: MAX_DETAIL_ROWS, total: graphicsTotal }
          : null,
      wrap: options.inventory.wrap,
    },
    survey: options.survey ?? null,
    notMeasured,
    caveats,
  };
}
