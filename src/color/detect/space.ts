/**
 * Family `space` — whether color is process and how many inks the job uses.
 *
 * On the working book this family produces ZERO findings
 * (`doc.inks.length = 4`, no RGB, no spot), so it is proven purely by
 * fixture. Zero here is the expected outcome, not a failure.
 */
import { buildFindings } from "../findings.js";
import type { ColorFinding, ColorMeasure, ColorSite } from "../types.js";

const ownerExample = (group: ColorSite[]): string[] => {
  const first = group[0];
  return first ? [first.ownerKind] : [];
};

export function detectNonCmyk(sites: ColorSite[]): ColorFinding[] {
  const hits: ColorSite[] = [];
  for (const s of sites) {
    if (s.color.space === "RGB" || s.color.space === "LAB") hits.push(s);
  }
  return buildFindings(hits, "space", "non-cmyk-color", ownerExample);
}

export function detectSpotApplied(sites: ColorSite[]): ColorFinding[] {
  const hits: ColorSite[] = [];
  for (const s of sites) {
    if (s.color.model === "SPOT" || s.color.model === "MIXEDINK") hits.push(s);
  }
  return buildFindings(hits, "space", "spot-applied", ownerExample);
}

/**
 * MORE inks than declared.
 *
 * Deliberately asymmetric: fewer inks than declared is a one- or
 * two-color job, and that's not a defect. More inks means a bill from the
 * print shop for an extra plate.
 *
 * Built BY HAND, not through buildFindings: there are no tuples here at
 * all — this is a verdict about the document, not about a location
 * (Ruling 1).
 */
export function detectUnexpectedInks(
  measure: ColorMeasure,
  expectedInks: number,
): ColorFinding[] {
  if (measure.inkCount <= expectedInks) return [];
  return [{
    family: "space",
    rule: "unexpected-ink-count",
    color: `${measure.inkCount} inks against the declared ${expectedInks}`,
    totalInk: null,
    count: measure.inkCount - expectedInks,
    surfaces: [],
    pages: [],
    pagesTotal: 0,
    examples: measure.inkNames,
  }];
}
