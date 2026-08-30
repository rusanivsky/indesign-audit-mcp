/**
 * B5.2. Calibration of natural space width, spec §4.2. Pure TypeScript.
 */

import {
  type MeasurableLine,
  type WidthContext,
  isMeasurable,
  isParagraphFinal,
  measureShortfall,
  median,
  widthContext,
} from "./measurable.js";
import type { Calibration, LineMeasure } from "./types.js";

/**
 * Calibration key. A `null` size (mixed within a paragraph — InDesign returns
 * NothingEnum) gets its own key «@mixed» and is NEVER calibrated: the space
 * width of such a paragraph isn't attributed to any single size, and lumping
 * it together with one of them would silently corrupt both.
 */
export function styleKey(styleName: string, pointSize: number | null): string {
  return `${styleName}@${pointSize ?? "mixed"}`;
}

/**
 * Space width — the distance to the next character. A space is not counted if
 * it's followed by a control character or nothing: it has no measured right
 * neighbor, and InDesign gives control characters a synthetic width unrelated
 * to justification.
 *
 * Only U+0020 is counted. The non-breaking space U+00A0 (28 per book) is
 * deliberately excluded from the sample: the composer stretches it
 * differently from a regular space, so as a sample of "100% of the desired
 * spacing" it's wrong.
 *
 * A line unsuitable for measurement (`isMeasurable`) yields no samples at
 * all: in an overset frame all coordinates are identical, and an empty
 * paragraph has no glyphs.
 */
export function spaceWidths(line: LineMeasure): number[] {
  return spaceGaps(line).map((g) => g.width);
}

/**
 * The same inter-word gap, but WITH COORDINATES: `[left; right)` in points.
 *
 * Needed for Task 11: a corridor is a vertical strip of WHITE, so it measures
 * not the gap's width but whether adjacent lines' gaps overlap horizontally.
 * The left coordinate alone is unsuitable for this: two gaps with left edges
 * 4pt apart overlap if each is 10.87pt wide (the book's measured worst-case
 * line), and don't overlap if each is 2.645pt wide (the measured natural
 * width).
 *
 * `spaceWidths` is now DERIVED FROM THIS function rather than a copy of it:
 * the rule "a space counts only with a printed right neighbor and only at a
 * positive width" is declared exactly once. Two copies would have drifted
 * apart silently — exactly the way two suitability rules (`isMeasurable`)
 * would have drifted.
 */
export function spaceGaps(line: LineMeasure): SpaceGap[] {
  if (!isMeasurable(line)) return [];
  const out: SpaceGap[] = [];
  for (let i = 0; i < line.chars.length - 1; i++) {
    if (line.chars[i]!.ch !== " ") continue;
    if (line.chars[i + 1]!.ch === null) continue;
    const left = line.chars[i]!.x;
    const right = line.chars[i + 1]!.x;
    const width = right - left;
    if (width > 0) out.push({ left, right, width });
  }
  return out;
}

/** Inter-word gap as a segment on the line's horizontal axis, in points. */
export interface SpaceGap {
  left: number;
  right: number;
  width: number;
}

/** Candidate samples, grouped by key. `eps` — the §4.2 filter; `null` — without it. */
function collect(
  lines: readonly MeasurableLine[],
  ctx: WidthContext,
  eps: Map<string, number> | null,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (const line of lines) {
    if (line.pointSize === null) continue; /* mixed size is not calibrated */
    /* A candidate for the calibration sample — only the paragraph's last line. */
    if (!isParagraphFinal(line)) continue;

    const key = styleKey(line.styleName, line.pointSize);
    if (eps !== null) {
      const e = eps.get(key);
      /* A line that reaches the measure is effectively justified — it doesn't enter the sample. */
      if (e !== undefined && measureShortfall(line, ctx) < e) continue;
    }

    const widths = spaceWidths(line);
    if (widths.length === 0) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(...widths);
    else buckets.set(key, [...widths]);
  }
  return buckets;
}

/** Fraction of samples within ±1% of the median. */
function stabilityOf(widths: readonly number[], med: number): number {
  if (widths.length === 0 || !(med > 0)) return 0;
  const within = widths.filter((w) => Math.abs(w - med) <= med * 0.01).length;
  return within / widths.length;
}

/**
 * Spec §4.2. In a justified paragraph the LAST line is not justified — its
 * spaces sit exactly at desiredWordSpacing, i.e. at 100% by definition. That's
 * why the natural width is taken specifically from last lines, not from font
 * metrics (unavailable) and not from control characters' synthetic width.
 *
 * TWO PASSES, NOT RECURSION. The assumption "the last line is not justified"
 * is false for about 1.5% of paragraphs: their last line was measured at
 * exactly the width of the measure (one even 0.25pt wider than it), its
 * spaces are compressed to 53% and 81%, and as a "100%" sample it introduces
 * a 47% error. So the last line is taken only when it falls short of the
 * effective measure by at least ε.
 *
 * ε is expressed in the style's own natural space widths, not as a constant
 * in points: the measured empty gap between the tightest genuine last line
 * (1.88e-9pt) and the next one (4.12pt) fits one space width at both of the
 * book's sizes (2.645 at 11.5; 3.220 at 14). An absolute 2pt also works on
 * THIS document, but doesn't carry over to other sizes and measures.
 *
 * ε depends on the median, which the filter itself helps compute. Solved
 * with two passes: the median is robust to the measured ~4% contamination —
 * with and without outliers it agrees to 15 significant digits — so the ε
 * from the unfiltered first pass produces the same filter as the ε from the
 * converged one. Recursion isn't needed here and would only add an
 * unpredictable number of passes.
 *
 * The filter's cost was measured: it discards 4 last lines out of 131
 * (3.1%), two of them genuine. The filter is deliberately over-cautious in
 * the safe direction — losing a genuine sample costs nothing when the median
 * is taken over hundreds of samples.
 */
export function calibrate(lines: readonly LineMeasure[], minSamples = 3): Calibration {
  const usable = lines.filter(isMeasurable);
  const ctx = widthContext(usable);

  /* Pass 1 — without the filter, just to get ε. */
  const first = collect(usable, ctx, null);
  const eps = new Map<string, number>();
  for (const [key, widths] of first) {
    const med = median(widths);
    if (med > 0) eps.set(key, med);
  }

  /* Pass 2 — with ε; its result IS the calibration. */
  const buckets = collect(usable, ctx, eps);

  const natural = new Map<string, number>();
  const samples = new Map<string, number>();
  const stability = new Map<string, number>();
  for (const [key, widths] of buckets) {
    const med = median(widths);
    samples.set(key, widths.length);
    stability.set(key, stabilityOf(widths, med));
    if (widths.length >= minSamples && med > 0) natural.set(key, med);
  }

  /*
   * Keys are taken only from lines suitable for measurement. Overset frames
   * and empty paragraphs land in neither "clean" nor "uncalibrated": they're
   * outside the composition analysis entirely, and flagging them would be
   * noise.
   */
  const seenKeys = new Set<string>();
  for (const line of usable) seenKeys.add(styleKey(line.styleName, line.pointSize));

  const uncalibrated = [...seenKeys].filter((k) => !natural.has(k)).sort();
  return { natural, samples, stability, uncalibrated };
}

/**
 * A line's density ratio: its space width against the natural one.
 *
 * null means "not measured" — the style is uncalibrated, the line is
 * unsuitable for measurement, or it has no suitable space at all. A number
 * cannot be invented in place of null: the line would land in the report as
 * clean, even though no one measured it.
 */
export function spacingRatio(line: LineMeasure, cal: Calibration): number | null {
  const nat = cal.natural.get(styleKey(line.styleName, line.pointSize));
  if (nat === undefined || nat <= 0) return null;
  const widths = spaceWidths(line);
  if (widths.length === 0) return null;
  return median(widths) / nat;
}
