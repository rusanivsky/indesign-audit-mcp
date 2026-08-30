/**
 * The `anchored` family.
 *
 * THREE POPULATIONS, NOT ONE — H13 measured on the working book:
 *   185  «Нумерація питань»       28.3×48 and 34×48 pt   question numbers
 *    35  «Зміст Номер сторінки»   28.3×20 pt             contents-page figures
 *    82  (not text, GraphicLine)  340.2×0 pt             inter-block rules
 * There is no shared "anchoring rule" among them, and `check-question-numbers.jsx`
 * cannot be generalized verbatim: its rule applies only to 185 of 303.
 *
 * WHAT THE FAMILY MAINLY RETURNS IS THE INVENTORY, without a verdict: whether a
 * number should hang in the margin is for the layout artist to decide.
 */
import { columnEdges } from "./reference.js";
import {
  comparePageNames,
  EPSILON,
  formatPt,
  type GeometryFinding,
  type ItemMeasure,
  type PageMeasure,
} from "./types.js";

export interface AnchoredPopulation {
  /** Paragraph style, or `(not text)` for graphics. */
  style: string;
  type: string;
  count: number;
  pages: string[];
  /**
   * How many pages there were BEFORE the list was truncated (`report.ts`). Present
   * only when truncation actually happened: in the book, this population is 185
   * items, and a full page list on a single line would by itself be the volume
   * that took down Phase 4.
   */
  pagesTotal?: number;
  sampleWidth: number;
  sampleHeight: number;
}

/**
 * The geometric rule for an anchor population.
 *
 * A PARAMETER WITH NO DEFAULT (user decision, 2026-08-15). The working book's
 * canonical rule — "frame's right edge = column's left edge" — is PASSED IN
 * here, not hardcoded: hardcoding it would mean baking this layout's constant
 * into the tool's code, exactly what the "must generalize across editions" rule
 * forbids.
 */
export interface AnchorRule {
  /** Which population (paragraph style). */
  style: string;
  /** Which frame edge is being checked. */
  edge: "left" | "right" | "top" | "bottom";
  /** What it's supposed to align to. */
  alignsTo: "column-start" | "column-end";
  /** Tolerance in points; if not named — EPSILON. */
  tolerance?: number;
  /**
   * ЧИ ДЗЕРКАЛИТЬСЯ ПРАВИЛО НА РОЗВОРОТІ. Замовчування `false` — поведінка,
   * що була доти.
   *
   * `edge` і `alignsTo` описують СТОРІНКОВИЙ простір: «ліворуч» — це ліворуч
   * на аркуші, а не «зсередини». Для правила, прив'язаного до зовнішнього
   * поля, цього не досить, і одна пара (edge, alignsTo) фізично не може
   * виразити його на обидві сторони розвороту.
   *
   * Канонічне правило робочої книжки — номер питання висить у ЗОВНІШНЬОМУ
   * полі: на парній сторінці зовнішнє поле ліворуч, тож ПРАВИЙ край рамки
   * лягає на ЛІВИЙ край шпальти; на непарній усе навпаки — ЛІВИЙ край рамки
   * на ПРАВИЙ край шпальти. Задане як `{edge:"right", alignsTo:"column-start"}`
   * без дзеркала, воно проходить на парних і дає ~450 pt розбіжності на
   * КОЖНІЙ непарній, тобто пів книжки хибних знахідок.
   *
   * `mirrored: true` означає: пара названа ДЛЯ ПАРНОЇ (лівої) сторінки, а на
   * непарній обидва боки міняються місцями. Полярність саме така, бо
   * канонічна пара з докстрінга — це і є парна форма; зміряно на
   * симетричному макеті: `columnEdges` дає [40, 320] на парній і [80, 360] на
   * непарній, тож у зовнішньому полі парної рамка стоїть ЛІВОРУЧ від шпальти
   * (правий край на 40 = column-start), а непарної — ПРАВОРУЧ (лівий край на
   * 360 = column-end).
   *
   * Прапорець явний, а не автоматичний, бо правило, прив'язане до
   * сторінкового простору (скажімо, до корінця макета з несиметричною
   * сіткою), теж законне.
   */
  mirrored?: boolean;
}

export function inventoryAnchored(items: ItemMeasure[]): AnchoredPopulation[] {
  const groups = new Map<string, AnchoredPopulation>();

  for (const item of items) {
    if (!item.anchored) continue;
    const style = item.anchorStyle ?? "(not text)";
    const key = `${style} ${item.type}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        style,
        type: item.type,
        count: 1,
        pages: [item.page],
        /* Zero height on the 82 rules is a normal state, not degeneracy.
         * There is no division by height here, and there can't be. */
        sampleWidth: item.bounds[3] - item.bounds[1],
        sampleHeight: item.bounds[2] - item.bounds[0],
      });
      continue;
    }
    existing.count += 1;
    if (!existing.pages.includes(item.page)) existing.pages.push(item.page);
  }

  const out = [...groups.values()];
  for (const row of out) row.pages.sort(comparePageNames);
  return out.sort((a, b) => b.count - a.count);
}

export function detectAnchorGeometry(
  items: ItemMeasure[],
  pages: PageMeasure[],
  rule: AnchorRule | undefined,
): GeometryFinding[] {
  /* No rule was named — the family returns the inventory and stays silent. This
   * isn't "nothing found", it's "nothing to judge by", and the two states must
   * not be conflated. */
  if (rule === undefined) return [];

  const byPage = new Map(pages.map((p) => [p.name, p]));
  const tolerance = rule.tolerance ?? EPSILON;
  const groups = new Map<string, { pages: string[]; count: number }>();

  for (const item of items) {
    if (!item.anchored) continue;
    if (item.anchorStyle !== rule.style) continue;

    const page = byPage.get(item.page);
    if (page === undefined) continue;

    /*
     * ПОВЕРНЕНІ РАМКИ — ПОЗА ВИРОКОМ, як і в detectNearMiss.
     *
     * `frame.ts` виключає їх із вирівнювання з названою причиною: у
     * поверненого елемента `geometricBounds` — це осьова ОБГОРТКА, а не його
     * сторони, тож «лівий край» такої рамки не є її лівим краєм. А
     * `detectAnchorGeometry` робить саме порівняння країв — і робив його на
     * повернених теж.
     *
     * Гірше було те, що звіт при цьому СТВЕРДЖУВАВ протилежне: рядок
     * «ALIGNMENT of N rotated frame(s) was not checked» друкується з
     * `rotatedExcluded`, а воно рахується лише коли запитано родину `frame`
     * — тобто з `families: ["anchored"]` застереження не з'являлося зовсім,
     * а повернені прив'язки все одно судилися.
     */
    if (item.rotation !== 0) continue;

    /*
     * Дзеркалення — ПЕРЕД вибором краю, а не після: міняються обидва боки
     * правила разом, інакше вийшла б третя, неіснуюча комбінація.
     */
    const flip = rule.mirrored === true && page.side === "right";
    const alignsTo = !flip ? rule.alignsTo
      : rule.alignsTo === "column-start" ? "column-end"
      : "column-start";
    const edge = !flip ? rule.edge
      : rule.edge === "left" ? "right"
      : rule.edge === "right" ? "left"
      : rule.edge;

    const edges = columnEdges(page);
    const first = edges[0];
    const last = edges[edges.length - 1];
    /* `columnEdges()` is guaranteed to return ≥ 2 elements: `n = Math.max(1,
     * columnCount)`, and the `n === 1` branch itself builds a two-edge array for
     * the measure. `undefined` here is a sign of a broken call, not a normal case
     * (the same principle as `nearestEdge` in frame.ts). Silently skipping it would
     * mask anchored elements disappearing from findings if this invariant is ever
     * broken. */
    if (first === undefined || last === undefined) {
      throw new Error("columnEdges() returned fewer than two edges");
    }
    const target = alignsTo === "column-start" ? first : last;

    const actual =
      edge === "left" ? item.bounds[1]
      : edge === "right" ? item.bounds[3]
      : edge === "top" ? item.bounds[0]
      : item.bounds[2];

    const off = Math.abs(actual - target);
    if (off <= tolerance) continue;

    const key = formatPt(off);
    const rec = groups.get(key) ?? { pages: [], count: 0 };
    rec.count += 1;
    if (!rec.pages.includes(item.page)) rec.pages.push(item.page);
    groups.set(key, rec);
  }

  return [...groups].map(([value, rec]) => ({
    family: "anchored" as const,
    defect: "anchor-geometry",
    pages: [...rec.pages].sort(comparePageNames),
    count: rec.count,
    value: `${value} pt`,
    detail: `Edge "${rule.edge}" did not align with "${rule.alignsTo}" under the named rule.`,
  }));
}
