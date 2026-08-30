/**
 * The `scale` family: scaled text. Pure TypeScript.
 *
 * WHY GROUPING BY VALUE, NOT CLASSIFICATION. Measured on the working
 * book: 19 stories with `horizontalScale` exactly 96 are a deliberate
 * layout technique ("squeezed it to fit"), while five TOC stories with
 * 109.632164859675 are a consequence of "Scale Text" on the frame, compensation for
 * vertical compression. The difference between a round number and fourteen
 * digits becomes visible BY ITSELF the moment identical values are collapsed into one row.
 * A tool that called this a defect would be wrong in 19 places out of 22
 * (spec §3).
 */

import type { ParagraphMeasure } from "../layout/types.js";
import type { ScaleMeasure, StyleFinding } from "./types.js";

/** A truncated list: how many are shown out of what total. Never silent. */
export interface Truncation {
  shown: number;
  total: number;
}

/** A paragraph style in a group's list: the key is `.id`, the name rides alongside. */
export interface ScaleGroupStyle {
  styleId: string;
  styleName: string;
}

export interface ScaleGroup {
  horizontalScale: number | null;
  verticalScale: number | null;
  paragraphs: number;
  /** Unique containers, in order of first appearance; truncated — see `containersTruncated`. */
  containers: string[];
  containersTruncated?: Truncation;
  /**
   * Unique paragraph styles, in order of first appearance — BY `.id`, with the name
   * alongside (final review, minor item 4).
   *
   * Previously this was `styleNames: string[]` — the SIXTH instance of the same
   * keying-by-name that the phase caught five times (`countUsage`,
   * `countDeviating`, `summariseByStyle`, `CharacterStyleUsage`,
   * `detail.styleId`). The consequence here is milder than the previous five: the list
   * is informational, not part of any count — but two different styles with an identical
   * name produced ONE row in it, and the operator could not see that the scale
   * touched both.
   */
  styles: ScaleGroupStyle[];
  stylesTruncated?: Truncation;
}

export interface ScaleGrouping {
  groups: ScaleGroup[];
  /** Present ONLY when there really were more groups than the ceiling. */
  groupsTruncated?: Truncation;
}

/**
 * The group key. Via `String()` deliberately: `109.632164859675` and
 * `109.632164859676` must remain DIFFERENT strings. Any rounding
 * here would merge the measured "Scale Text" case with its neighbor and
 * make the family's main signature invisible.
 */
function key(s: ScaleMeasure): string {
  return `${String(s.horizontalScale)}|${String(s.verticalScale)}`;
}

/**
 * The ceiling on the NUMBER OF GROUPS in the default response (final review, I-6).
 *
 * The phase already put a ceiling on `detail`, but the default response was left
 * with structures unbounded BY CONSTRUCTION, and this is the sharpest of them: the
 * group key deliberately contains the EXACT float value (see `key` above), i.e.
 * the construction MAXIMIZES the number of groups. A document where every frame is
 * scaled with its own "Scale Text" would produce as many groups as paragraphs —
 * and the tool has no `pages` parameter and always walks the entire document.
 * The measured 9,187 B is a 9-page fixture, and it says nothing about
 * a 198-page one.
 *
 * THE NUMBER IS NOT MEASURED, and that is stated plainly: 50 is the same order of magnitude
 * already established in the project for a per-request list (`MAX_DETAIL_ITEMS`,
 * `MAX_CANDIDATES_PER_REQUEST`). Truncation happens AFTER sorting by
 * descending paragraph count, so the smallest groups disappear, not random ones,
 * and the fact of truncation itself is named in `groupsTruncated` — a silent truncation
 * would read as "these are all the scale values present in the document."
 */
export const MAX_SCALE_GROUPS = 50;

/**
 * The ceiling on lists INSIDE a group (containers, styles). The same reason:
 * a group of 2000 paragraphs in 2000 different frames would give 2000 rows in
 * `containers`, and no ceiling on the number of GROUPS covers that.
 */
export const MAX_GROUP_MEMBERS = 50;

function truncate<T>(items: T[], max: number): { items: T[]; truncated?: Truncation } {
  if (items.length <= max) return { items };
  return { items: items.slice(0, max), truncated: { shown: max, total: items.length } };
}

export function groupScales(scales: ScaleMeasure[]): ScaleGrouping {
  const byKey = new Map<string, ScaleGroup>();
  /* The full lists live separately from the group itself: they need to be truncated ONCE
   * at the end, not on every addition — otherwise `total` in
   * `containersTruncated` would lie, showing the ceiling instead of the true total. */
  const membersByKey = new Map<string, { containers: string[]; styles: ScaleGroupStyle[] }>();

  for (const s of scales) {
    const k = key(s);
    let g = byKey.get(k);
    let members = membersByKey.get(k);
    if (!g || !members) {
      g = {
        horizontalScale: s.horizontalScale,
        verticalScale: s.verticalScale,
        paragraphs: 0,
        containers: [],
        styles: [],
      };
      members = { containers: [], styles: [] };
      byKey.set(k, g);
      membersByKey.set(k, members);
    }
    g.paragraphs += 1;
    if (members.containers.indexOf(s.containerId) === -1) members.containers.push(s.containerId);
    /* Uniqueness is by `.id`, not by name: see the docstring of `ScaleGroup.styles`. */
    if (!members.styles.some((x) => x.styleId === s.styleId)) {
      members.styles.push({ styleId: s.styleId, styleName: s.styleName });
    }
  }

  for (const [k, g] of byKey) {
    const members = membersByKey.get(k)!;
    const containers = truncate(members.containers, MAX_GROUP_MEMBERS);
    const styles = truncate(members.styles, MAX_GROUP_MEMBERS);
    g.containers = containers.items;
    if (containers.truncated) g.containersTruncated = containers.truncated;
    g.styles = styles.items;
    if (styles.truncated) g.stylesTruncated = styles.truncated;
  }

  const sorted = [...byKey.values()].sort((a, b) => b.paragraphs - a.paragraphs);
  const capped = truncate(sorted, MAX_SCALE_GROUPS);
  return capped.truncated ? { groups: capped.items, groupsTruncated: capped.truncated } : { groups: capped.items };
}

/**
 * The scale ratio, agreed between point size and leading.
 *
 * MEASURED: two independent ratios matching to within 1e-6 means
 * the frame was scaled with "Scale Text." The number isn't off the shelf — exactly
 * this tolerance is what the book's three measured cases gave.
 */
const RATIO_EPSILON = 1e-6;

export interface RatioMatch {
  containerId: string;
  paragraphIndex: number;
  page: string | null;
  styleName: string;
  ratio: number;
}

/**
 * A SECOND, CONFIRMATORY detector: the paragraph's ratio to the DECLARED style.
 *
 * Strictly weaker than `horizontalScale`, and the limit is measured, not assumed:
 * it misses the book's biggest case entirely (131 TOC paragraphs), because
 * the style on top was changed after scaling, and there is no ratio against the new reference.
 * It stays because two independent detectors already saved the
 * conclusion once — the `everyItem()` trap broke the first and did not touch the
 * second.
 *
 * `noRatio` is a blind spot, named by a number: `Leading.AUTO` or an unavailable
 * declared value. Measured on the book: 163 of 2980 paragraphs (5.5%).
 */
export function detectRatioScale(
  paragraphs: ParagraphMeasure[],
): { matches: RatioMatch[]; noRatio: number } {
  const matches: RatioMatch[] = [];
  let noRatio = 0;

  for (const p of paragraphs) {
    const ds = p.declared.pointSize;
    const as = p.actual.pointSize;
    const dl = p.declared.leading;
    const al = p.actual.leading;
    if (typeof ds !== "number" || typeof as !== "number" || ds === 0) { noRatio += 1; continue; }
    if (typeof dl !== "number" || typeof al !== "number" || dl === 0) { noRatio += 1; continue; }

    const sizeRatio = as / ds;
    const leadRatio = al / dl;
    if (Math.abs(sizeRatio - 1) < RATIO_EPSILON) continue;
    if (Math.abs(sizeRatio - leadRatio) >= RATIO_EPSILON) continue;

    matches.push({
      containerId: p.containerId,
      paragraphIndex: p.paragraphIndex,
      page: p.page,
      styleName: p.styleName,
      ratio: sizeRatio,
    });
  }

  return { matches, noRatio };
}

export function detectScale(scales: ScaleMeasure[]): StyleFinding[] {
  return scales.map((s) => ({
    family: "scale" as const,
    defect: "scaled-text" as const,
    styleName: s.styleName,
    styleId: s.styleId,
    page: s.page,
    containerId: s.containerId,
    paragraphIndex: s.paragraphIndex,
    /* The wording is deliberately neutral — see the comment at the top of the file. */
    detail:
      `Text scale: horizontal ${String(s.horizontalScale)}, ` +
      `vertical ${String(s.verticalScale)}.`,
  }));
}
