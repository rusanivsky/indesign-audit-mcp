/**
 * Selecting and grouping color tuples.
 *
 * The seam between the raw measurement and the detectors. Detectors do NOT
 * know about layers and don't filter on their own: if each one filtered,
 * `includeNonPrinting` would have to be kept in sync in six places, and the
 * sixth would eventually drift.
 */
import { describeColor } from "./ink.js";
import type { ColorSite } from "./types.js";

/** Whether the tuple has a color that can be said anything about at all. */
export function isJudgeable(site: ColorSite): boolean {
  return site.color.kind === "solid" && site.color.value !== null;
}

/**
 * Whether the tuple is a color USAGE, not a swatch DEFINITION in the palette.
 *
 * Spec §5.2: "zero usages with a definition present is not a finding". This
 * isn't a nicety: `[Registration]` = CMYK 100/100/100/100 exists in EVERY
 * InDesign document and can't be deleted. A detector that judged definitions
 * would report `tac-over-limit` 400% on any file in the world — proven by
 * running the built tool on a document where the color exists ONLY in the
 * palette.
 *
 * The gate sits HERE, in one place, not in every detector, for exactly the
 * reason named in the file header: five detectors with their own copies had
 * already drifted (two had the gate, three didn't), and drifted silently.
 *
 * STYLE definitions are deliberately excluded here: a style lands on every
 * one of its usages, and rich black baked into a definition is a genuine
 * defect (see `colorScanStyles`, "a style's point size is needed by the
 * black family").
 */
export function isUsage(site: ColorSite): boolean {
  return site.surface !== "swatch";
}

export interface SelectOptions {
  includeNonPrinting: boolean;
  includeHidden: boolean;
}

export function selectSites(sites: ColorSite[], opts: SelectOptions): ColorSite[] {
  const out: ColorSite[] = [];
  for (const s of sites) {
    if (!isJudgeable(s)) continue;
    if (!isUsage(s)) continue;
    if (!s.laysInk) continue;
    if (!opts.includeNonPrinting && !s.printable) continue;
    if (!opts.includeHidden && !s.visible) continue;
    out.push(s);
  }
  return out;
}

/**
 * The group key is the COLOR DESCRIPTION together with the tint.
 *
 * The unit of a report row is a class, not an element: 84 identical rules
 * must produce one row. A per-item report already put the tool out of
 * commission in Phase 4 (78 KB).
 */
export function groupSites(sites: ColorSite[]): Map<string, ColorSite[]> {
  const groups = new Map<string, ColorSite[]>();
  for (const s of sites) {
    const key = describeColor(s.color, s.tint);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [s]);
    else bucket.push(s);
  }
  return groups;
}

/**
 * The group's page list, ordered NUMERICALLY.
 *
 * String ordering would give "1, 10, 100, 17, 2" — a list in which the
 * layout artist can't find their page. Non-numeric names (masters) go at
 * the end, keeping their own order.
 */
export function pagesOf(sites: ColorSite[]): string[] {
  const seen = new Set<string>();
  const numeric: { label: string; n: number }[] = [];
  const other: string[] = [];
  for (const s of sites) {
    const label = s.page !== null
      ? s.page
      : s.master !== null
        ? `master ${s.master}`
        : "pasteboard";
    if (seen.has(label)) continue;
    seen.add(label);
    const n = Number.parseInt(label, 10);
    if (Number.isNaN(n)) other.push(label);
    else numeric.push({ label, n });
  }
  numeric.sort((a, b) => a.n - b.n);
  return [...numeric.map((x) => x.label), ...other];
}
