/**
 * The `black` family — what the black is built from.
 *
 * Two different defects under one name, and the report does not mix them:
 *   [Registration] on content   — an unconditional defect, no threshold;
 *   rich black under small text — a defect CAUSED BY point size.
 */
import { buildFindings } from "../findings.js";
import { classifyBlack } from "../ink.js";
import type { ColorFinding, ColorSite } from "../types.js";

/**
 * `[Registration]` on a content element.
 *
 * NO THRESHOLD AND NO PARAMETER. The swatch's presence in the palette is NOT itself a
 * finding: it can't be deleted, it exists in every InDesign document, and a detector
 * that reported it would be reporting the app's built-in behavior.
 */
export function detectRegistrationApplied(sites: ColorSite[]): ColorFinding[] {
  const hits: ColorSite[] = [];
  for (const s of sites) {
    if (s.surface === "swatch") continue;
    if (classifyBlack(s.color) === "registration") hits.push(s);
  }
  return buildFindings(hits, "black", "registration-applied");
}

/**
 * Rich black under small text.
 *
 * The cause is registration mismatch on press: four inks that land with a
 * fraction-of-a-millimeter offset produce a colored halo around a letter's outline, and the
 * smaller the point size, the larger the share of the stroke that halo eats into. On a 200×70 mm
 * solid the same mix is normal and often intentional, which is why tuples without a point
 * size never reach this detector at all.
 */
export function detectRichBlackSmallText(
  sites: ColorSite[],
  maxPointSize: number,
): ColorFinding[] {
  const hits: ColorSite[] = [];
  for (const s of sites) {
    if (s.pointSize === null || s.pointSize >= maxPointSize) continue;
    const kind = classifyBlack(s.color, s.tint);
    if (kind === "rich" || kind === "registration") hits.push(s);
  }
  return buildFindings(hits, "black", "rich-black-small-text");
}
