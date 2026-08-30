/**
 * The `color_audit` report.
 *
 * The unit of a row is a COLOR CLASS, not an element: 84 identical rules
 * produce one row with a count. A per-element report already took the tool
 * down in Phase 4 (78 KB), and rolling up identical findings in Phase 6
 * brought that down from 33,437 B to 733 B.
 */
import type { DistanceBucket } from "./detect/palette.js";
import type { TacBucket } from "./detect/tac.js";
import type { ColorFinding, ColorMeasure, Family, Surface } from "./types.js";

/** The same ceilings as in `geometry_audit`: one response, one order of magnitude. */
export const MAX_DETAIL_ROWS = 60;

/**
 * СТЕЛЯ НА КОЖНУ РОДИНУ ОКРЕМО, А НЕ СПІЛЬНА НА ВСІ.
 *
 * Доти був плаский `findings.slice(0, 60)` по порядку, в якому родини
 * складали в масив (`src/tools/color.ts`): tac → black → palette → space →
 * overprint. Тобто досить понад шістдесяти знахідок TAC або безіменних
 * кольорів — і кожен рядок `space` та `overprint` зникав із відповіді цілком,
 * разом із `overprint-on-white`, який цей-таки модуль зве найдорожчим:
 * на екрані видно, на відбитку зникає. `findingsTruncated` повідомляв лише
 * {shown, total} і НЕ називав, що зрізано саме родину.
 *
 * Це та сама вада, яку сусідній `src/typography/auditcap.ts` уже вирішив
 * стелею НА ВИД і прямо застерігає проти спільної: «рідкісний вид витісняє
 * частий». П'ять родин × 12 = ті самі 60 рядків, але жодна не може
 * витіснити іншу.
 */
export const MAX_DETAIL_ROWS_PER_FAMILY = 12;
export const MAX_PAGES_PER_ROW = 25;

export interface ReportOptions {
  families: readonly Family[];
  maxTotalInk: number;
  richBlackMaxPointSize: number;
  expectedInks: number;
  includeNonPrinting: boolean;
  /** Ruling 6: a hidden layer is a separate skip reason from a non-printing one. */
  includeHidden: boolean;
  paletteThresholdNamed: boolean;
  sitesJudged: number;
  sitesSkippedNonPrinting: number;
  /** Ruling 6: how many sites were skipped because of `layer.visible = false`. */
  sitesSkippedHidden: number;
  /** Ruling 8: how many sites were skipped because the color doesn't land as ink geometrically. */
  sitesSkippedNoInk: number;
  /**
   * Ruling 12: how many `pageItem` tuples have `overprint === null` —
   * InDesign refused to report the overprint state (zero ink coverage).
   * This makes the `overprint-on-white` rule silent NOT because it's clean
   * there.
   */
  sitesOverprintUnknown: number;
  tacSurvey: TacBucket[] | null;
  paletteSurvey: DistanceBucket[] | null;
}

export interface ColorReport {
  docName: string;
  caveat: string;
  parameters: Record<string, number | boolean>;
  findingCount: number;
  occurrenceCount: number;
  findings: ColorFinding[];
  findingsTruncated?: {
    shown: number;
    total: number;
    byFamily: { family: Family; shown: number; total: number }[];
  };
  counters: ColorMeasure["counters"];
  unreadSurfaces: Surface[];
  unmeasurableLinks: string[];
  layers: ColorMeasure["layers"];
  inkCount: number;
  inkNames: string[];
  tacSurvey: TacBucket[] | null;
  paletteSurvey: DistanceBucket[] | null;
  elapsedMs: number;
}

/**
 * The sentence without which a zero reads as the wrong thing.
 *
 * Built from THIS run's own numbers — like `caveat` in `preflight_document`.
 * The ink-coverage limit is declared as applied, not derived from the
 * document: the document knows nothing about the paper or the print shop.
 * On the working book, 286 of 1128 elements are legitimately not judged for
 * THREE distinct reasons (196 — non-printing layer, 6 — hidden layer, 84 —
 * zero area), and each reason gets its OWN sentence: a single number that
 * lumped them together would say less than the instrument knows.
 */
function buildCaveat(measure: ColorMeasure, opts: ReportOptions): string {
  const parts: string[] = [];
  parts.push(
    `Checked ${opts.sitesJudged} sites where color is applied. The ink-coverage limit of ` +
      `${opts.maxTotalInk}% is used as a parameter, not derived from the document: ` +
      `the document knows nothing about the paper or the print shop.`,
  );
  if (!opts.paletteThresholdNamed) {
    parts.push(
      "The near-miss threshold isn't named, so the palette family only reports " +
        "the distance breakdown and unnamed colors, not a verdict on a miss.",
    );
  }
  if (opts.sitesSkippedNonPrinting > 0) {
    parts.push(
      `Skipped ${opts.sitesSkippedNonPrinting} sites on non-printing layers ` +
        `(includeNonPrinting=false).`,
    );
  }
  if (opts.sitesSkippedHidden > 0) {
    parts.push(
      `Skipped ${opts.sitesSkippedHidden} sites on HIDDEN layers ` +
        `(includeHidden=false): a hidden layer doesn't print by default.`,
    );
  }
  if (opts.sitesSkippedNoInk > 0) {
    parts.push(
      `Did not judge ${opts.sitesSkippedNoInk} sites where color doesn't land as ink: ` +
        `a zero-area object's fill (a line has no interior) or a zero-width ` +
        `stroke. This is a property of the geometry, not a setting.`,
    );
  }
  if (opts.sitesOverprintUnknown > 0) {
    parts.push(
      `Overprint was NOT READ at ${opts.sitesOverprintUnknown} ` +
        `sites: InDesign refuses to report overprint for zero ` +
        `ink coverage. The overprint-on-white rule is silent at these sites not ` +
        `because they're clean, but because the tool can't see there.`,
    );
  }
  const unmeasurable = measure.links.filter((l) => !l.inkMeasurable).map((l) => l.name);
  if (unmeasurable.length > 0) {
    parts.push(
      `NOT MEASURED AT ALL: ink coverage inside ${unmeasurable.length} ` +
        `placements (${unmeasurable.join(", ")}). The script sees the link's color ` +
        `space, not the ink in a pixel; a 400% black inside such a file is not ` +
        `found by this tool.`,
    );
  }
  return parts.join(" ");
}

export function buildReport(
  measure: ColorMeasure,
  findings: ColorFinding[],
  opts: ReportOptions,
): ColorReport {
  let occurrences = 0;
  for (const f of findings) occurrences += f.count;

  /*
   * Ріжемо в межах кожної родини, зберігаючи вихідний порядок: рядок родини,
   * яких мало, більше не може бути витіснений родиною, яких багато.
   */
  const perFamily = new Map<Family, number>();
  const cutByFamily = new Map<Family, { shown: number; total: number }>();
  for (const f of findings) {
    const seen = (perFamily.get(f.family) ?? 0) + 1;
    perFamily.set(f.family, seen);
  }
  const takenSoFar = new Map<Family, number>();
  const trimmed: ColorFinding[] = [];
  for (const f of findings) {
    const taken = takenSoFar.get(f.family) ?? 0;
    if (taken >= MAX_DETAIL_ROWS_PER_FAMILY) continue;
    takenSoFar.set(f.family, taken + 1);
    trimmed.push({ ...f, pages: f.pages.slice(0, MAX_PAGES_PER_ROW) });
  }
  for (const [family, total] of perFamily) {
    const shown = takenSoFar.get(family) ?? 0;
    if (shown < total) cutByFamily.set(family, { shown, total });
  }

  /* "Not read" means seen > 0 while parsed === 0. A surface that doesn't exist
   * in the document (seen === 0) is not unread: zero tables is a property of
   * the book, not a failure of the instrument. */
  const unread: Surface[] = [];
  for (const c of measure.counters) {
    if (c.seen > 0 && c.parsed === 0) unread.push(c.surface);
  }

  const report: ColorReport = {
    docName: measure.docName,
    caveat: buildCaveat(measure, opts),
    parameters: {
      maxTotalInk: opts.maxTotalInk,
      richBlackMaxPointSize: opts.richBlackMaxPointSize,
      expectedInks: opts.expectedInks,
      includeNonPrinting: opts.includeNonPrinting,
      includeHidden: opts.includeHidden,
    },
    findingCount: findings.length,
    occurrenceCount: occurrences,
    findings: trimmed,
    counters: measure.counters,
    unreadSurfaces: unread,
    unmeasurableLinks: measure.links.filter((l) => !l.inkMeasurable).map((l) => l.name),
    layers: measure.layers,
    inkCount: measure.inkCount,
    inkNames: measure.inkNames,
    tacSurvey: opts.tacSurvey,
    paletteSurvey: opts.paletteSurvey,
    elapsedMs: measure.ms,
  };
  if (trimmed.length < findings.length) {
    report.findingsTruncated = {
      shown: trimmed.length,
      total: findings.length,
      /* ЯКІ САМЕ родини зрізано — без цього читач бачить «показано 60 зі 140»
       * і не має підстав запідозрити, що цілої родини в переліку немає. */
      byFamily: [...cutByFamily].map(([family, n]) => ({ family, ...n })),
    };
  }
  return report;
}
