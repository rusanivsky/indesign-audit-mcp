/**
 * Assembling findings from tuples — the SHARED seam for all six families.
 *
 * WHY A SEPARATE MODULE, NOT A COPY IN EACH FAMILY. Reducing tuples to a
 * report line is an identical operation for tac, black, palette, space and
 * overprint: group by color value, collect surfaces, order pages, count
 * occurrences. Five copies would drift apart at the first format change —
 * and drift silently, since each would have its own tests.
 */
import { totalInk } from "./ink.js";
import { groupSites, pagesOf } from "./sites.js";
import type { ColorFinding, ColorSite, Family, Surface } from "./types.js";

/**
 * Examples for a finding line.
 *
 * A function, not a ready-made array: the example must describe ITS OWN
 * group. A shared examples array, computed once for all groups, would stick
 * to the wrong finding — that was exactly the bug in the plan's code for
 * `unnamed-duplicate-of-swatch`.
 */
export type ExampleBuilder = (group: ColorSite[]) => string[];

/** Default: the carrier's constructor name, and for text, also the point size. */
export const defaultExamples: ExampleBuilder = (group) => {
  const out: string[] = [];
  for (const s of group.slice(0, 3)) {
    out.push(s.pointSize !== null ? `${s.ownerKind} ${s.pointSize} pt` : s.ownerKind);
  }
  return out;
};

export function buildFindings(
  sites: ColorSite[],
  family: Family,
  rule: string,
  examples: ExampleBuilder = defaultExamples,
): ColorFinding[] {
  const findings: ColorFinding[] = [];
  for (const [color, group] of groupSites(sites)) {
    const surfaces = new Set<Surface>();
    for (const s of group) surfaces.add(s.surface);
    const pages = pagesOf(group);
    const first = group[0];
    if (first === undefined) continue;
    findings.push({
      family,
      rule,
      color,
      totalInk: totalInk(first.color, first.tint),
      count: group.length,
      surfaces: [...surfaces],
      pages,
      pagesTotal: pages.length,
      examples: examples(group),
    });
  }
  return findings;
}
