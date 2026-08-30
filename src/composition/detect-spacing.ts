/**
 * B5.3a. Detector of tight and loose lines. Pure TypeScript.
 *
 * WHY THE THRESHOLD IS MANDATORY, WITH NO DEFAULT
 * =============================================
 * The task's briefing proposed the rule "a defect is when the ratio hits the bound
 * declared by the style." That rule is measured, and it's unfit as a default:
 * on the real book it flags **220 of 372 justified lines, i.e. 59.14%**
 * (docs/measured-facts-phase3.md). A report that flags most of the book isn't a
 * report.
 *
 * Replacing it with a number tuned to this particular book isn't possible either, and this isn't
 * caution — it's a direct instruction from the measurement: "Task 8's threshold shouldn't be hard-coded
 * to a number tuned to one document" — 59.14% is a property of THIS manuscript.
 *
 * The main point: there simply is no number here that could be derived. Compare with Task 7's
 * ε — there, the threshold rested on a MEASURED EMPTY GAP: between 1.88e-9 pt and
 * 4.12 pt there isn't a single sample, and ε falls into that emptiness. Here there's no emptiness:
 * the distribution is continuous and heavy-tailed (p05 = 0.767, p50 = 1.305, p75 = 1.786,
 * p95 = 2.824, max 4.971), there isn't a single gap in the histogram, and NOT A SINGLE line of
 * the book was flagged by a human as "a defect" or "acceptable." In other words, nobody measured
 * the boundary between acceptable and defective, and any number I set as a
 * default would be made up — with the difference that the report would pass it off as a
 * measurement.
 *
 * Hence: `mode` is mandatory, there's no default.
 *  - `"style-bounds"` — the briefing's rule, available as an explicit choice. It honestly returns
 *    its 59% and is fit as an ANSWER TO THE QUESTION "what violates the standard at all,"
 *    not as a daily report;
 *  - `"ratio"` — a threshold named by a human who looked at the distribution.
 * So that "a human looked at the distribution" doesn't mean "guessed," `surveySpacing()`
 * lives right here: it returns the distribution and the base rate, flagging nothing.
 * The order of work Task 12 needs to support: survey first, then threshold.
 *
 * WHAT TO DO WITH A FLAGGED LINE
 * =============================
 * At a base rate of 59% a plain list of lines isn't actionable. So findings are returned
 * RANKED by rejection strength (worst first), exactly as the measurement demands:
 * "Task 8 should rank by rejection strength, and keep the style's 80/133 bounds as
 * reference in the finding's explanation, not as a selection criterion."
 *
 * That's exactly why there's a THIRD mode — `"rank"`, which RANKS WITHOUT SELECTING. It's the
 * literal reading of the measurement: no threshold at all, every measured justified
 * line gets a finding, the style bounds sit in the explanation as reference and only
 * drive the weight. Task 12's request "the twenty worst lines of the document" is
 * `detectSpacing(lines, cal, { mode: "rank" }).slice(0, 20)`. This mode didn't
 * need a single made-up number, so it has no default threshold either.
 *
 * Truncating the report to the N worst is deliberately NOT done here: Task 12 splits
 * the document into batches of pages, and truncating inside the detector would give N per batch
 * instead of N per document. The limit belongs to the report layer, ranking to the detector.
 */

import { spaceWidths, spacingRatio, styleKey } from "./calibrate.js";
import { findingId } from "./finding.js";
import { isJustified, isMeasurable, isParagraphFinal, percentile } from "./measurable.js";
import type { Calibration, Finding, LineMeasure, Severity } from "./types.js";

/**
 * The selection criterion. There's no default — the rationale is in the file header.
 * `"rank"` selects nothing: it ranks everything that's measured.
 */
export type SpacingMode = "style-bounds" | "ratio" | "rank";

export interface SpacingOptions {
  /**
   * MANDATORY. `"style-bounds"` — the bounds declared by the style itself (in this
   * book, 80/133); `"ratio"` — the bounds from `minRatio`/`maxRatio`; `"rank"` — no selection
   * at all, all measured lines by descending rejection strength.
   */
  mode: SpacingMode;
  /**
   * Bounds for `mode: "ratio"`. FRACTIONS, not percentages: 1.33, not 133. At least one
   * is required; giving only one means the other side isn't checked at all
   * (not that it's "clean").
   */
  minRatio?: number;
  maxRatio?: number;
  /**
   * Width of the warning band INSIDE the bounds, in percentage points. A line in the
   * band gets `severity: "warning"` — it doesn't yet cross the bound, but it's already close.
   * Zero (the default) — no warnings. Not used in `"rank"` mode:
   * there's no selection there, and the weight comes from the style bounds.
   */
  warnBandPct?: number;
  /**
   * Count lines on parent (master) pages.
   *
   * Phase 3 debt, closed in Phase 4 (spec §8): previously `isMaster` was filtered
   * only by Task 12's handler, so a standalone detector silently counted
   * running heads as ordinary text. The policy is now declared HERE, where it takes effect.
   *
   * Default `false`: a running head is calibrated against its own, usually a
   * DIFFERENT style, and the book's main-text justification bounds are foreign to it.
   */
  includeMasters?: boolean;
}

/*
 * `findingId` MOVED to `./finding.js` (Task 11). It was born here, and the two
 * following detectors imported it from here — meaning the spacing-density module
 * became the de facto owner of a shared vocabulary. There's deliberately no re-export
 * here: two import paths would leave this file a fake owner.
 */

/**
 * Why a line didn't make it into the denominator — or what its ratio is.
 *
 * `"not-measured"` and `"clean"` are DIFFERENT things, and that's exactly why this is a
 * discriminated union, not `number | null`: a line of an uncalibrated style has no verdict at all and
 * shouldn't fall into "clean."
 */
export type SpacingVerdict =
  | { kind: "ratio"; ratio: number; styleKey: string }
  | { kind: "not-measurable" }
  | { kind: "paragraph-final" }
  | { kind: "not-justified" }
  | { kind: "not-measured" };

/**
 * The ONE place where it's decided whether a line is in scope for this detector at all.
 * Shared between `detectSpacing` and `surveySpacing` deliberately: two copies of this
 * sequence would drift apart, and the report would start counting a different denominator than
 * the one it flags against.
 *
 * EXPORTED deliberately: otherwise Task 12 would re-derive this rule and, over time,
 * drift from the detector's denominator.
 *
 * The order of checks goes from the coarsest filter to the finest; every line
 * falls into exactly one category.
 */
export function spacingVerdict(line: LineMeasure, cal: Calibration): SpacingVerdict {
  /* 595 of the book's 5,193 lines (11.5%): rotated frames and empty paragraphs. */
  if (!isMeasurable(line)) return { kind: "not-measurable" };
  /* Not excluded by construction; it's also the calibration sample. */
  if (isParagraphFinal(line)) return { kind: "paragraph-final" };
  /* 50.2% of the book's lines (2,608 of 5,193; Task 9's review correction — see
   * `JUSTIFIED` in measurable.ts); each trivially yields exactly 1.000. */
  if (!isJustified(line)) return { kind: "not-justified" };

  /* By contract, `spacingRatio` returns either null or a positive number. */
  const ratio = spacingRatio(line, cal);
  if (ratio === null) return { kind: "not-measured" };
  return { kind: "ratio", ratio, styleKey: styleKey(line.styleName, line.pointSize) };
}

/** Bounds applicable to a line. `null` on a side — that side isn't checked. */
export interface Bounds {
  min: number | null;
  max: number | null;
}

/**
 * Style bounds arrive from InDesign in percent and can be `null` — a mixed
 * value within the paragraph. `null` means "not measured," not "no bound,"
 * so that side simply isn't checked: making up a bound would mean passing off an
 * unmeasured line as either clean or defective.
 *
 * The sides are INDEPENDENT: `spacing.min` and `spacing.max` are each nullable separately, so
 * a line can exist that's judgeable from only one side. Anything that counts bounds must
 * count them one at a time — see `SpacingSurvey`.
 */
export function styleBounds(line: LineMeasure): Bounds {
  return {
    min: line.spacing.min === null ? null : line.spacing.min / 100,
    max: line.spacing.max === null ? null : line.spacing.max / 100,
  };
}

/**
 * The ONE predicate for "a line beyond the bound," and that's exactly why it's exported.
 *
 * Until now the same comparison stood in three places — selection, ranking, and survey —
 * and the review showed the cost: edge-case coverage existed in only one of them, and
 * the survey's copy counted `outsideStyleBounds`, i.e. the very same base rate the
 * entire threshold argument rests on. This is exactly the flaw the module
 * guards the eligibility denominator against (`spacingVerdict`), just one floor up.
 *
 * The comparisons are INCLUSIVE on both sides: the measurement counts "≥133% or ≤80%" as out of
 * bounds, meaning a line exactly on the declared bound has already exhausted it.
 *
 * The warning band is the same predicate against NARROWED bounds, not a separate
 * comparison: otherwise the bound would live in two places again.
 */
export function boundSide(ratio: number, bounds: Bounds): "loose" | "tight" | null {
  if (bounds.max !== null && ratio >= bounds.max) return "loose";
  if (bounds.min !== null && ratio <= bounds.min) return "tight";
  return null;
}

/** Bounds narrowed by the warning band. A zero band leaves them unchanged. */
function narrowed(bounds: Bounds, band: number): Bounds {
  return {
    min: bounds.min === null ? null : bounds.min + band,
    max: bounds.max === null ? null : bounds.max - band,
  };
}

/** Reference rendering of the style bounds for the explanation text. */
function styleBoundsText(line: LineMeasure): string {
  const min = line.spacing.min === null ? "?" : String(line.spacing.min);
  const max = line.spacing.max === null ? "?" : String(line.spacing.max);
  return `${min}–${max}%`;
}

/**
 * REJECTION STRENGTH used to rank findings: the excess (or shortfall) of
 * inter-word air in the line, as a SHARE OF THE MEASURE.
 *
 * ```
 * (Σ space widths − space count × natural width) / columnWidth
 * ```
 *
 * Positive — the line is loose, negative — tight; ranking takes the absolute value.
 *
 * WHY THIS AND NOT "how many times wider the space is than natural"
 * (`max(ratio, 1/ratio)`, which stood here in the first draft):
 *
 * 1. **Symmetry of the ratio isn't symmetry of what's visible on the page.** At
 *    2.0, each gap ADDS a whole space width; at 0.5, it TAKES AWAY half the
 *    width. The ratio calls them equal; the page doesn't.
 * 2. **The ratio can't see HOW MANY gaps are stretched.** The book's worst
 *    measured case is described in exactly these terms: "ten spaces
 *    of 10.87 pt each — that's 108.7 pt of 'air' in a 368.5 pt column, almost 30%
 *    of the line." Two stretched gaps and ten are different defects, and the ratio
 *    doesn't distinguish between them at all.
 * 3. **The quantity is physical and normalized by the measure**, so it's comparable across point sizes,
 *    styles, and columns of different width, and reads as "this much percent
 *    of the line is air."
 * 4. It's computed from fields `LineMeasure` already carries; no new measurements are needed.
 *
 * WHAT THIS LOSES compared to `max(ratio, 1/ratio)` — a trade named by the review and recorded
 * here so it isn't forgotten: the tight side is now BOUNDED. The tightest possible
 * line has zero-width spaces, meaning `−Σnatural / columnWidth` ≈ 10–20% of the measure,
 * while the loose side is unbounded. In other words the quantity makes the two sides
 * comparable IN UNITS, but not in RANGE; given a sufficiently loose
 * outlier, no tight line can climb to the top. The old metric was
 * unbounded on both sides — that's the one respect in which it was better.
 *
 * A CONSEQUENCE Task 12 needs to know: the value grows with the number of gaps,
 * so in `"rank"` mode a long line that's LEGAL within the style's bounds can theoretically
 * outrank a shorter one that violates the bound. Two gaps of 4.0 give 6 natural
 * widths of air; a line at 1.25 (within the 80/133 bounds) would only catch up at 24
 * gaps. At this book's measure (368.5 pt with a natural space of 2.645 pt),
 * that many gaps don't fit, so this is unreachable here — but it's reachable on a narrow
 * column. The old metric never did this, because it didn't see bounds at all.
 *
 * `null` — the strength is NOT MEASURED: the style is uncalibrated, the line has no
 * eligible space at all, or the measure isn't positive. Zero here would be a lie ("the line
 * is perfectly natural") in a module whose whole point is that these are different things.
 */
export function airFraction(line: LineMeasure, cal: Calibration): number | null {
  const nat = cal.natural.get(styleKey(line.styleName, line.pointSize));
  if (nat === undefined || !(nat > 0)) return null;
  const widths = spaceWidths(line);
  if (widths.length === 0 || !(line.columnWidth > 0)) return null;
  const total = widths.reduce((a, b) => a + b, 0);
  return (total - widths.length * nat) / line.columnWidth;
}

/**
 * Flags lines where the compositor exhausted its freedom.
 *
 * Does not flag — and does not declare clean — lines unfit for measurement,
 * non-justified lines, paragraph-final lines, and uncalibrated ones. Findings are returned by
 * descending rejection strength.
 */
export function detectSpacing(
  lines: readonly LineMeasure[],
  cal: Calibration,
  opts: SpacingOptions,
): Finding[] {
  if (opts.mode === "ratio" && opts.minRatio === undefined && opts.maxRatio === undefined) {
    throw new Error(
      'detectSpacing: mode "ratio" requires minRatio or maxRatio. ' +
        'There is deliberately no default: on the measured sample (the first 400 paragraphs), the style-bounds ' +
        'rule flags 59.14% of justified lines, and there is no number that can be derived for the whole book — ' +
        'see surveySpacing().',
    );
  }

  const band = (opts.warnBandPct ?? 0) / 100;
  const out: Finding[] = [];

  for (const line of lines) {
    if (line.isMaster && !opts.includeMasters) continue;
    const verdict = spacingVerdict(line, cal);
    if (verdict.kind !== "ratio") continue;
    const ratio = verdict.ratio;

    const bounds =
      opts.mode === "ratio"
        ? { min: opts.minRatio ?? null, max: opts.maxRatio ?? null }
        : styleBounds(line);

    let defect: "loose" | "tight" | null = null;
    let severity: Severity | null = null;
    let limit: number | null = null;

    if (opts.mode === "rank") {
      /* No selection: everything measured is ranked. The side is taken from the
       * ratio itself — exactly 1.000 has no side and isn't ranked. */
      if (ratio > 1) defect = "loose";
      else if (ratio < 1) defect = "tight";

      /* The weight is the ONE place the style bounds take part in, and it must
       * distinguish "within bounds" from "bounds not measured." Otherwise a line with mixed
       * bounds would pass itself off as one that meets the standard — the very same
       * "null = clean" substitution the rest of the module guards against. */
      const side = boundSide(ratio, bounds);
      const bothKnown = bounds.min !== null && bounds.max !== null;
      severity = side !== null ? "error" : bothKnown ? "info" : "unrated";
    } else {
      const side = boundSide(ratio, bounds);
      if (side !== null) {
        defect = side;
        severity = "error";
        limit = side === "loose" ? bounds.max : bounds.min;
      } else {
        /* The warning band is the same predicate against narrowed bounds. */
        const warned = boundSide(ratio, narrowed(bounds, band));
        if (warned !== null) {
          defect = warned;
          severity = "warning";
          limit = warned === "loose" ? bounds.max : bounds.min;
        }
      }
    }

    if (defect === null || severity === null) continue;

    const air = airFraction(line, cal);
    /*
     * STRENGTH-SIGN CONSISTENCY — Phase 3 debt, closed 2026-08-05.
     *
     * `defect` (loose/tight) is taken from `spacingRatio`, i.e. from the MEDIAN of space
     * widths. `strength` is from `airFraction`, i.e. from the SUM. For a uniformly
     * justified line this is the same answer, but mathematically not one and the
     * same quantity: a line of three narrow spaces and one very wide one
     * gives a median of "tight" while the total air is in EXCESS. Then the finding
     * would say "tight," while the strength measured an excess — two statements about
     * opposite things in one record.
     *
     * Measured on the user's book (pages 40–49, rank mode): 59 findings,
     * 0 disagreements. So on a uniformly justified sample the case doesn't occur — but
     * that's a property of the corpus, not of the contract, and a silent contradiction is worse than
     * a named one.
     *
     * What's done: the strength is zeroed and this is stated in `detail`. The finding
     * isn't dropped — the defect is real, the line really is uneven; `|air|` isn't kept
     * either — it would describe the wrong side. Zero strength equals "tracking
     * not measured," and `propose.ts` honestly declines on it.
     */
    const airDisagrees =
      air !== null && air !== 0 && (air > 0) !== (defect === "loose");
    const strength = air === null || airDisagrees ? 0 : Math.abs(air);

    out.push({
      id: findingId(line, defect),
      defect,
      severity,
      page: line.page,
      containerId: line.containerId,
      paragraphIndex: line.paragraphIndex,
      lineInParagraph: line.lineInParagraph,
      lineText: line.text,
      measured: ratio,
      /* The ranking key travels TOGETHER with the finding, rather than staying in this function:
       * the report layer pools batches of pages, and without this field it could reproduce the
       * document's order only by keeping every `LineMeasure` and the calibration and
       * recomputing the strength from scratch. That's exactly the work this module spares it. */
      strength,
      detail:
        `Inter-word spacing ${(ratio * 100).toFixed(0)}% of natural; ` +
        (limit === null ? "no selection was applied (ranking). " : `threshold ${(limit * 100).toFixed(0)}%. `) +
        (air === null
          ? "excess air not measured. "
          : `Excess air ${(air * 100).toFixed(1)}% of the measure. `) +
        (airDisagrees
          ? "WARNING: the line's spaces are INCONSISTENT — the median says " +
            `"${defect === "loose" ? "loose" : "tight"}", while the total air says the ` +
            "opposite. Strength is zeroed (0): tracking won't fix the cause here, because the measured " +
            "values contradict each other. "
          : "") +
        `Style bounds "${line.styleName}" — ${styleBoundsText(line)} (for reference).`,
    });
  }

  /* Ranked by rejection strength; ties broken by key, so the order is
   * reproducible across runs rather than depending on sort stability. */
  out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Style-bounds accounting. The sides are INDEPENDENTLY nullable, so a line can be
 * judged from both sides, one, or neither, and they can't be dumped into one denominator:
 * a line whose only measured bound is the lower one can never be loose, and
 * in a shared denominator it would dilute exactly the loose share.
 *
 * So the base rate is computed ONLY over `known` (both bounds measured), while
 * `partial` and `unknown` are kept visible as separate numbers. Those in `partial`
 * that did cross their one measured bound aren't lost — they're in
 * `outsidePartial`, just not in the rate.
 */
export interface SpacingBoundsCount {
  /** BOTH bounds measured — the base rate's denominator. */
  known: number;
  /** Exactly one measured: the line is judgeable from only one side. */
  partial: number;
  /** Neither measured (mixed bounds within the paragraph). */
  unknown: number;
  /** From `known` — those beyond the bound. The base rate's numerator. */
  outsideKnown: number;
  /** From `partial` — those beyond their one measured bound. */
  outsidePartial: number;
  /** `outsideKnown / known`; NaN on a zero denominator, not 0. */
  baseRate: number;
}

/** Summary for one (style, point size) pair — the breakdown Task 12 should show. */
export interface SpacingStyleSummary {
  measured: number;
  bounds: SpacingBoundsCount;
}

/** Distribution of ratios across the range — input for a human choosing the threshold. */
export interface SpacingSurvey {
  /** The denominator: lines for which a ratio was actually computed. */
  measured: number;
  /** The same ratios, ascending. */
  ratios: number[];
  /** Nearest-rank percentiles; NaN on an empty sample. */
  percentiles: { p05: number; p25: number; p50: number; p75: number; p95: number; max: number };
  /**
   * Style-bounds accounting with a READY-MADE base rate (`bounds.baseRate`).
   *
   * The rate is computed here, rather than left as a comment: previously the denominator
   * (`measured − boundsUnknown`) lived only in a doc comment, meaning Task 12 would
   * have to divide by hand — and on a quick read would divide by `measured`,
   * bringing back exactly the dilution the counter was introduced to eliminate.
   * On the measured book, `baseRate` = 0.5914.
   */
  bounds: SpacingBoundsCount;
  /** Outside the denominator by construction — these are NOT "clean" lines. */
  excluded: { notMeasurable: number; paragraphFinal: number; notJustified: number };
  /** No verdict: the style is uncalibrated, or the line has no spaces. */
  notMeasured: number;
  /**
   * The same thing broken down by calibration key. The measurement shows the rate differs
   * by style (63.1% vs. 58.3%), meaning there's signal in the breakdown, and without it
   * Task 12's report loses it.
   */
  byStyle: Map<string, SpacingStyleSummary>;
}

/**
 * Measures, but doesn't flag anything. Exists because the detector's threshold is mandatory:
 * a human needs to see the distribution BEFORE naming a number, otherwise
 * "mandatory parameter" turns into "guess."
 */
export function surveySpacing(lines: readonly LineMeasure[], cal: Calibration): SpacingSurvey {
  const ratios: number[] = [];
  const excluded = { notMeasurable: 0, paragraphFinal: 0, notJustified: 0 };
  const byStyle = new Map<string, SpacingStyleSummary>();
  const bounds = emptyBounds();
  let notMeasured = 0;

  for (const line of lines) {
    const verdict = spacingVerdict(line, cal);
    switch (verdict.kind) {
      case "not-measurable":
        excluded.notMeasurable++;
        continue;
      case "paragraph-final":
        excluded.paragraphFinal++;
        continue;
      case "not-justified":
        excluded.notJustified++;
        continue;
      case "not-measured":
        notMeasured++;
        continue;
      case "ratio": {
        ratios.push(verdict.ratio);
        const b = styleBounds(line);
        countBounds(bounds, verdict.ratio, b);

        let s = byStyle.get(verdict.styleKey);
        if (s === undefined) {
          s = { measured: 0, bounds: emptyBounds() };
          byStyle.set(verdict.styleKey, s);
        }
        s.measured++;
        countBounds(s.bounds, verdict.ratio, b);
        continue;
      }
    }
  }

  finishBounds(bounds);
  for (const s of byStyle.values()) finishBounds(s.bounds);

  ratios.sort((a, b) => a - b);
  return {
    measured: ratios.length,
    ratios,
    percentiles: {
      p05: percentile(ratios, 0.05),
      p25: percentile(ratios, 0.25),
      p50: percentile(ratios, 0.5),
      p75: percentile(ratios, 0.75),
      p95: percentile(ratios, 0.95),
      max: ratios.length === 0 ? NaN : ratios[ratios.length - 1]!,
    },
    bounds,
    excluded,
    notMeasured,
    byStyle,
  };
}

function emptyBounds(): SpacingBoundsCount {
  return { known: 0, partial: 0, unknown: 0, outsideKnown: 0, outsidePartial: 0, baseRate: NaN };
}

/** One line into the bounds accounting. The same predicate as in the detector. */
function countBounds(acc: SpacingBoundsCount, ratio: number, b: Bounds): void {
  const sides = (b.min === null ? 0 : 1) + (b.max === null ? 0 : 1);
  const outside = boundSide(ratio, b) !== null;
  if (sides === 2) {
    acc.known++;
    if (outside) acc.outsideKnown++;
  } else if (sides === 1) {
    acc.partial++;
    if (outside) acc.outsidePartial++;
  } else {
    acc.unknown++;
  }
}

/** NaN, not 0: "nothing to measure against" and "found nothing" are different things. */
function finishBounds(acc: SpacingBoundsCount): void {
  acc.baseRate = acc.known === 0 ? NaN : acc.outsideKnown / acc.known;
}
