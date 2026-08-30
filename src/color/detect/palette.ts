/**
 * Family `palette` — whether a color was taken from the palette.
 *
 * Three distinct events, and the report separates them because their
 * fixes differ:
 *   unnamed                         — color bypassed a swatch entirely;
 *   unnamed duplicate of a swatch   — the same color already exists in the
 *                                     palette, but was applied around it
 *                                     (fix: assign the swatch);
 *   near miss                       — almost but not quite the same (fix:
 *                                     decide which of the two is correct).
 */
import { buildFindings } from "../findings.js";
import { colorDistance, describeColor } from "../ink.js";
import type { ColorFinding, ColorRef, ColorSite } from "../types.js";

/** Distance histogram bucket bounds, as a percentage of the largest component. */
const DISTANCE_LIMITS = [0, 2, 5, 10, 20, 40];

export interface DistanceBucket {
  upTo: number | null;
  count: number;
}

function unnamedApplied(sites: ColorSite[]): ColorSite[] {
  const out: ColorSite[] = [];
  for (const s of sites) {
    if (s.surface === "swatch") continue;
    if (s.color.named === null) out.push(s);
  }
  return out;
}

export function detectUnnamed(sites: ColorSite[]): ColorFinding[] {
  return buildFindings(unnamedApplied(sites), "palette", "unnamed-color", () => []);
}

interface Nearest {
  swatch: ColorRef | null;
  distance: number | null;
}

function nearest(color: ColorRef, swatches: ColorRef[]): Nearest {
  let best: Nearest = { swatch: null, distance: null };
  for (const sw of swatches) {
    const d = colorDistance(color, sw);
    if (d === null) continue;
    if (best.distance === null || d < best.distance) best = { swatch: sw, distance: d };
  }
  return best;
}

export function detectPaletteMiss(
  sites: ColorSite[],
  swatches: ColorRef[],
  threshold: number,
): ColorFinding[] {
  const duplicates: ColorSite[] = [];
  const misses: ColorSite[] = [];

  for (const s of unnamedApplied(sites)) {
    const n = nearest(s.color, swatches);
    if (n.distance === null || n.swatch === null) continue;
    if (n.distance === 0) duplicates.push(s);
    else if (n.distance <= threshold) misses.push(s);
  }

  /* The example is computed FROM THE GROUP, not from the first tuple of the
   * whole branch (Ruling 2): otherwise duplicates with different colors
   * would all get the same one example. */
  const dupExample = (group: ColorSite[]): string[] => {
    const first = group[0];
    if (first === undefined) return [];
    const n = nearest(first.color, swatches);
    return n.swatch !== null ? [`matches swatch ${describeColor(n.swatch, -1)}`] : [];
  };
  const missExample = (group: ColorSite[]): string[] => {
    const first = group[0];
    if (first === undefined) return [];
    const n = nearest(first.color, swatches);
    if (n.swatch === null) return ["closest swatch not determined"];
    return [`closest swatch ${describeColor(n.swatch, -1)}, deviation ${n.distance} %`];
  };

  return [
    ...buildFindings(duplicates, "palette", "unnamed-duplicate-of-swatch", dupExample),
    ...buildFindings(misses, "palette", "near-miss-of-swatch", missExample),
  ];
}

export function surveyPaletteDistance(
  sites: ColorSite[],
  swatches: ColorRef[],
): DistanceBucket[] {
  const buckets: DistanceBucket[] = [];
  for (const limit of DISTANCE_LIMITS) buckets.push({ upTo: limit, count: 0 });
  buckets.push({ upTo: null, count: 0 });

  for (const s of unnamedApplied(sites)) {
    const n = nearest(s.color, swatches);
    if (n.distance === null) continue;
    let placed = false;
    for (let i = 0; i < DISTANCE_LIMITS.length; i++) {
      const limit = DISTANCE_LIMITS[i];
      if (limit === undefined) break;
      if (n.distance <= limit) {
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
