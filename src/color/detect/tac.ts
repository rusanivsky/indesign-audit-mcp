/**
 * Family `tac` — how much ink lands on a dot.
 *
 * The rule is trivial (a sum of four numbers), and that's exactly why this
 * phase isn't about the rule but about the walker: finding every place
 * where a color lives is harder than adding the numbers up.
 */
import { buildFindings } from "../findings.js";
import { totalInk } from "../ink.js";
import type { ColorFinding, ColorSite } from "../types.js";

/**
 * Upper bounds of the histogram buckets, in percent.
 *
 * Not "round numbers off the top of the head": 240 is the newsprint offset
 * limit, 260 is typical for uncoated stock, 300 is ISO 12647-2 for coated
 * sheetfed, and 320 and above is never anything but an error. The
 * histogram exists so a human can see the shape of the signal, the same
 * way the out-of-bounds histogram did in Phase 13.
 */
const BUCKET_LIMITS = [100, 200, 240, 260, 280, 300, 320];

export interface TacBucket {
  /** `null` — the last bucket, "greater than everything before it". */
  upTo: number | null;
  count: number;
}

export function detectTacOverLimit(sites: ColorSite[], maxTotalInk: number): ColorFinding[] {
  const over: ColorSite[] = [];
  for (const s of sites) {
    const ink = totalInk(s.color, s.tint);
    if (ink !== null && ink > maxTotalInk) over.push(s);
  }

  const findings = buildFindings(over, "tac", "tac-over-limit", (g) => {
    const first = g[0];
    return first ? [first.ownerKind] : [];
  });
  findings.sort((a, b) => (b.totalInk ?? 0) - (a.totalInk ?? 0));
  return findings;
}

export function surveyTac(sites: ColorSite[]): TacBucket[] {
  const buckets: TacBucket[] = [];
  for (const limit of BUCKET_LIMITS) buckets.push({ upTo: limit, count: 0 });
  buckets.push({ upTo: null, count: 0 });

  for (const s of sites) {
    const ink = totalInk(s.color, s.tint);
    if (ink === null) continue;
    let placed = false;
    for (let i = 0; i < BUCKET_LIMITS.length; i++) {
      const limit = BUCKET_LIMITS[i];
      if (limit === undefined) break;
      if (ink <= limit) {
        const bucket = buckets[i];
        if (bucket) {
          bucket.count++;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const lastBucket = buckets[buckets.length - 1];
      if (lastBucket) lastBucket.count++;
    }
  }
  return buckets;
}
