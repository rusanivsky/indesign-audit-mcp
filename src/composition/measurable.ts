/**
 * B5.2. Shared measurement corrections for all composition detectors (Tasks 7–11).
 *
 * Boundary of responsibility: the module knows only about `LineMeasure` and
 * the three measured corrections without which comparing a line's width
 * against the measure is wrong. Reimplementing them separately in every
 * detector is not allowed — that's exactly how detectors would silently
 * diverge, each ending up measuring a slightly different thing.
 *
 * Three corrections (evidence — docs/measured-facts-phase3.md):
 *  1. unmeasurable lines are discarded entirely — 595 of 5,193 (11.5%);
 *  2. a hyphen drawn by the compositor is NOT included in `right` — 100 lines
 *     fall short of the measure by ~3.91 pt at 11.5 pt size;
 *  3. a trailing space, conversely, IS included in `right` and legitimately
 *     hangs past the measure — 13 lines "exceed" it by up to 4.599 pt.
 */

import type { LineMeasure } from "./types.js";

declare const measurableBrand: unique symbol;

/**
 * A line that has passed the measurability rule. The type is a barrier
 * against INATTENTION, not a guarantee: the rule used to live only in a doc
 * comment, and the cost of getting it wrong is measured — empty paragraphs
 * return the FULL measure at an own width of 2.3–7.6 pt and look like the
 * crudest typesetting defects there are.
 *
 * WHAT THIS ACTUALLY STOPS (verified with `tsc --noEmit --strict`):
 * - passing a raw `LineMeasure`, or `.map` over a raw array;
 * - a homemade predicate of one's own instead of `isMeasurable`;
 * - `JSON.parse(s) as LineMeasure`;
 * - mutating fields AFTER narrowing (`l.rotated = true`) — `Readonly` is
 *   here for exactly this, and it's the same idiom this task's own tests use.
 *
 * WHAT IT DOESN'T STOP — and what must not be relied on:
 * - `{ ...m, rotated: true, chars: [] }`: spreading carries the brand over
 *   onto an object that violates the rule (verified: `Readonly` does NOT
 *   help here, because spreading copies every property, brand included);
 * - `Object.assign(m, { rotated: true })`;
 * - mutating inside `chars` — `Readonly` is shallow;
 * - `effectiveRight(JSON.parse(s))`: untyped `JSON.parse` is `any`.
 *
 * The last point isn't theoretical: `MeasureResult` arrives from JSX as
 * JSON, and there's no runtime validator in `src/`. Task 12 needs a typed
 * parse at the JSX boundary, otherwise the brand holds nothing there.
 */
export type MeasurableLine = Readonly<LineMeasure> & { readonly [measurableBrand]: true };

/**
 * The ONE measurability rule (recorded in the `LineMeasure` doc comment):
 * `!rotated && chars.some(c => c.ch !== null)`. Do not derive one of your own.
 */
export function isMeasurable(line: LineMeasure): line is MeasurableLine {
  return !line.rotated && line.chars.some((c) => c.ch !== null);
}

/** The same rule for an array — narrows the type, not just filters. */
export function measurableLines(lines: readonly LineMeasure[]): MeasurableLine[] {
  return lines.filter(isMeasurable);
}

/**
 * The justification kinds for which the notion of "stretched space" is
 * even defined.
 *
 * Measured (docs/measured-facts-phase3.md): in 27 `LEFT_ALIGN` lines the
 * space-width ratio equals exactly 1.000 in ALL 27, and none of them can
 * ever be flagged. Keeping them in the denominator understates the true
 * share of findings — that's exactly why the first round of measurement
 * gave 55.14% instead of 59.14%.
 *
 * CORRECTION (Task 9 review): non-justified lines in the document are
 * **50.2%** (2,608 of 5,193: `LEFT_ALIGN` 2,182, `CENTER_ALIGN` 379,
 * `RIGHT_ALIGN` 47). This used to read 42% — that's the share of
 * `LEFT_ALIGN` alone. The mistake lived in a summary sentence in
 * docs/measured-facts-phase3.md, contradicting its own distribution table,
 * and it erred in the direction that WEAKENED the argument, which is why it
 * survived two rounds. The facts are now fixed.
 */
const JUSTIFIED = new Set([
  "LEFT_JUSTIFIED",
  "RIGHT_JUSTIFIED",
  "CENTER_JUSTIFIED",
  "FULLY_JUSTIFIED",
]);

/** The line's paragraph is justified, i.e. the compositor was allowed to move spaces. */
export function isJustified(line: LineMeasure): boolean {
  return JUSTIFIED.has(line.justification);
}

/**
 * The paragraph's last line. It is NOT justified (spec §4.2) — and at the
 * same time the calibration was taken from it, so measuring it against
 * itself would be pointless. One implementation for all of Tasks 7–11: two
 * declarations would have silently diverged.
 */
export function isParagraphFinal(line: LineMeasure): boolean {
  return line.lineInParagraph === line.paragraphLineCount - 1;
}

/**
 * Nearest-rank percentile. REQUIRES an array already sorted ascending — it
 * doesn't sort it itself, because it's called several times over the same
 * sample. On an empty sample it's NaN, not 0: "nothing to measure" and
 * "measured zero" are different things.
 *
 * Lives here, not in `detect-spacing.ts` where it originated: the Task 8
 * and Task 9 reviews compute percentiles of different quantities, and two
 * copies of this function would have diverged at the edges just as
 * silently as two measurability rules would have.
 */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil(q * sorted.length);
  const i = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[i]!;
}

/** Median. Doesn't mutate the input array; NaN on an empty one. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return NaN;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Characters treated as an already-drawn hyphen: if a line ends with one of
 * these, the hyphenation mark sits in the text and is ALREADY included in
 * `right`. U+00AD (soft hyphen) is deliberately included here — at a break
 * it does get drawn, and it must not be given the allowance a second time.
 */
const HYPHEN_CHARS = new Set(["-", "\u2010", "\u00AD"]);

/** The same characters whose width can be measured directly (excluding the
 *  soft hyphen: its glyph width off a break is zero, so as a sample it's
 *  unreliable). */
const MEASURABLE_HYPHENS = new Set(["-", "\u2010"]);

/**
 * Width of the compositor-drawn hyphen, in FRACTIONS OF THE POINT SIZE.
 *
 * Measured on the book only at 11.5 pt size: justified lines with a hyphen
 * fall short of the measure by 3.9099–3.9100 pt, and without a hyphen hit it
 * to within ±0.001 pt. 3.9100 / 11.5 = 0.34.
 *
 * THE UNCERTAINTY TO LIVE WITH: 3.91 pt is a number for ONE point size of
 * ONE typeface. Glyph widths scale with point size, so 3.91 pt cannot be
 * hard-coded — at 14 pt it would give 0.9 pt of error. A fraction of the
 * point size carries the measurement to other sizes, but not to a different
 * typeface; that's why `widthContext()` DERIVES this number from the data
 * itself whenever the range has lines ending in a literal hyphen, and falls
 * back to this only in their absence.
 *
 * TASK 8'S SOLUTION (completed; Task 7 handed it off here). There are only
 * a handful of literal hyphens in the book, so on a real run the literal
 * path alone would almost always fall through to the fallback. So a SECOND
 * path was added — the median of `(columnWidth − effective width without
 * allowance) / pointSize` over JUSTIFIED non-final lines with
 * `endsWithHyphen`: 100 samples instead of a handful. The assumption that
 * "a justified line reaches the measure" is not taken on faith here but
 * MEASURED — 1,403 justified lines without a hyphen hit `columnWidth` to
 * within ±0.001 pt, while the 100 with a hyphen sit at 3.9099–3.9100 pt
 * with a total spread of 0.0001 pt (docs/measured-facts-phase3.md).
 *
 * Task 7's objection — `endsWithHyphen` is a "letter + letter" heuristic,
 * so a false positive would poison the median — is removed by TWO MEASURED
 * FILTERS, not by assurance:
 *  - a false positive on a justified line gives a shortfall ≈0 (the line
 *    reaches the measure), so anything not exceeding `SHORTFALL_NOISE_PT`
 *    is discarded;
 *  - a hyphen cannot be wider than the point size, so samples at
 *    `HYPHEN_EM_LIMIT` or above (a line that simply falls short of the
 *    measure) are discarded too.
 * What the filters let through, the median absorbs; what would
 * systematically corrupt the sample is visible through `hyphenSource` and
 * `hyphenDisagreementEm`, which Task 12 is required to show in the report.
 *
 * Source order: literal measurement (direct glyph width) → derivation from
 * shortfalls → 0.34 em as the last resort. BOTH measured paths go through
 * the same minimum sample count: otherwise one literal hyphen per document
 * would displace the hundred-sample shortfall median, and the stronger
 * source would simply never fire (measured: the old literal-hyphen rule
 * fired 2 times in 5,193 lines).
 */
export const HYPHEN_EM_FALLBACK = 0.34;

/**
 * The threshold for "a shortfall is real, not a mirage," in points.
 *
 * PROVENANCE (fixed after review; the first draft cited the wrong
 * measurement). The number rests on the section about the shortfall
 * itself: **1,403 justified lines WITHOUT a hyphen have a shortfall median
 * of 0.0000 pt within ±0.001 pt** (docs/measured-facts-phase3.md). That is,
 * in this direction — when a line reaches the measure — the entire observed
 * error fits within ±0.001 pt, and 0.01 pt gives it a tenfold margin while
 * staying ~390 times smaller than the real shortfall of a hyphenated line
 * (3.91 pt).
 *
 * WHAT'S NO LONGER HERE. The earlier draft cited an empty band of
 * 0.01–0.25 pt from the table of measure EXCESSES. That citation was wrong:
 * that band was measured on the opposite sign (a line wider than the
 * measure), on the raw `right` before the trailing-space correction, and
 * that table's own conclusion is that all 13 excesses are trailing spaces.
 * It says nothing at all about sample density in the shortfall zone.
 */
const SHORTFALL_NOISE_PT = 0.01;

/**
 * A hyphen's glyph is narrower than the point size in any typeface — a
 * physical bound, not a chosen threshold. A sample of one em or above means
 * the line simply falls short of the measure, and `endsWithHyphen` fired
 * falsely.
 */
const HYPHEN_EM_LIMIT = 1;

/**
 * The same as `calibrate(…, minSamples = 3)`: one convention per block.
 * Applies to BOTH measured paths — see the comment on `HYPHEN_EM_FALLBACK`
 * for why the literal path has no privilege.
 */
const HYPHEN_MIN_SAMPLES = 3;

/** Where the hyphen width came from. Task 12 must show this in the report. */
export type HyphenSource = "literal" | "shortfall" | "fallback";

/** Corrections shared across the entire measurement range. */
export interface WidthContext {
  /** Width of the hyphenation mark, in fractions of the point size. */
  hyphenEm: number;
  /** Source of the number — measured, derived, or the fallback value. */
  hyphenSource: HyphenSource;
  /** How many samples went into the chosen source's median; 0 for the fallback. */
  hyphenSamples: number;
  /**
   * Disagreement between the two measured paths, in fractions of the point
   * size, when both have gathered samples; `null` when there's nothing to
   * compare them against. A nonzero value means one of the assumptions
   * doesn't hold, and Task 12 must surface it rather than silently take the
   * first one.
   */
  hyphenDisagreementEm: number | null;
}

const FALLBACK_CONTEXT: WidthContext = {
  hyphenEm: HYPHEN_EM_FALLBACK,
  hyphenSource: "fallback",
  hyphenSamples: 0,
  hyphenDisagreementEm: null,
};

/** A context with no allowance at all — needed in order to MEASURE the allowance itself. */
const NO_ALLOWANCE: WidthContext = { ...FALLBACK_CONTEXT, hyphenEm: 0 };

/** Index of the last NON-space glyph; −1 if there is none. */
function lastGlyphIndex(line: MeasurableLine): number {
  for (let i = line.chars.length - 1; i >= 0; i--) {
    const ch = line.chars[i]!.ch;
    if (ch === null) continue;
    if (/\s/.test(ch)) continue;
    return i;
  }
  return -1;
}

/** The right edge of character `i` is the left coordinate of the next one,
 *  and for the line's last character it's `right` itself. */
function rightEdgeOf(line: MeasurableLine, i: number): number {
  return line.chars[i + 1]?.x ?? line.right;
}

/** Allowance for the hyphenation mark for a specific line, in points. */
export function hyphenAllowance(line: MeasurableLine, ctx: WidthContext = FALLBACK_CONTEXT): number {
  if (!line.endsWithHyphen) return 0;
  if (line.pointSize === null) return 0; /* mixed point size — nothing to scale by */
  const i = lastGlyphIndex(line);
  /* A literal or soft hyphen already sits in the text and is already included in `right`. */
  if (i >= 0 && HYPHEN_CHARS.has(line.chars[i]!.ch!)) return 0;
  return line.pointSize * ctx.hyphenEm;
}

/**
 * The line's right boundary, suitable for comparison against the measure:
 * the right edge of the last NON-space glyph plus the allowance for a
 * drawn hyphen.
 *
 * This is NOT `line.right`. `right` includes a trailing space, which
 * legitimately hangs past the measure (13 lines of the book "exceed" it by
 * up to 4.599 pt), and excludes the hyphenation mark (100 lines fall short
 * by ~3.91 pt). Both errors are of the same order as the defects the
 * detectors are meant to catch.
 *
 * A line of nothing but spaces yields `left`, i.e. zero width.
 */
export function effectiveRight(line: MeasurableLine, ctx: WidthContext = FALLBACK_CONTEXT): number {
  const i = lastGlyphIndex(line);
  const edge = i < 0 ? line.left : rightEdgeOf(line, i);
  return edge + hyphenAllowance(line, ctx);
}

/** Line width under the same corrections, in points. */
export function effectiveWidth(line: MeasurableLine, ctx: WidthContext = FALLBACK_CONTEXT): number {
  return effectiveRight(line, ctx) - line.left;
}

/**
 * Shortfall against the effective measure, in points. Positive — the line
 * is shorter than the measure; zero or negative — the line reaches it, i.e.
 * it's effectively justified.
 */
export function measureShortfall(line: MeasurableLine, ctx: WidthContext = FALLBACK_CONTEXT): number {
  return line.columnWidth - effectiveWidth(line, ctx);
}

/**
 * Path 1 — DIRECT MEASUREMENT. Lines ending in a LITERAL hyphen: such a
 * mark is a text character, so its width is visible directly from the
 * coordinates (right edge minus left), divided by the point size. Assumes
 * nothing about the line's justification.
 */
function literalHyphenEms(lines: readonly LineMeasure[]): number[] {
  const ems: number[] = [];
  for (const line of lines) {
    if (!isMeasurable(line)) continue;
    if (line.pointSize === null || line.pointSize <= 0) continue;
    const i = lastGlyphIndex(line);
    if (i < 0) continue;
    if (!MEASURABLE_HYPHENS.has(line.chars[i]!.ch!)) continue;
    const w = rightEdgeOf(line, i) - line.chars[i]!.x;
    if (!(w > 0)) continue;
    const em = w / line.pointSize;
    /* The same physical bound as in the derivation: a hyphen is narrower than
     * the point size. Without it the literal path would remain the only one
     * without any plausibility check. */
    if (em >= HYPHEN_EM_LIMIT) continue;
    ems.push(em);
  }
  return ems;
}

/**
 * Path 2 — DERIVATION FROM SHORTFALLS. A justified, non-final line reaches
 * the measure (measured: 1,403 such lines hit `columnWidth` to within
 * ±0.001 pt), so when such a line also has a hyphen, its entire shortfall
 * IS the drawn hyphen (measured: 100 lines, 3.9099–3.9100 pt at 11.5 pt
 * size).
 *
 * Filters against false positives of `endsWithHyphen` — see the comment on
 * `HYPHEN_EM_FALLBACK`.
 */
function shortfallHyphenEms(lines: readonly LineMeasure[]): number[] {
  const ems: number[] = [];
  for (const line of lines) {
    if (!isMeasurable(line)) continue;
    if (!line.endsWithHyphen) continue;
    if (!isJustified(line)) continue; /* a non-justified line falls short of the measure */
    if (isParagraphFinal(line)) continue; /* the last line also falls short */
    if (line.pointSize === null || line.pointSize <= 0) continue;
    const i = lastGlyphIndex(line);
    /* A literal or soft hyphen is already included in `right` — they don't produce a shortfall. */
    if (i >= 0 && HYPHEN_CHARS.has(line.chars[i]!.ch!)) continue;
    const shortfall = measureShortfall(line, NO_ALLOWANCE);
    if (shortfall <= SHORTFALL_NOISE_PT) continue;
    const em = shortfall / line.pointSize;
    if (em >= HYPHEN_EM_LIMIT) continue;
    ems.push(em);
  }
  return ems;
}

/**
 * Derives the corrections from the range itself. Both measured paths are
 * always computed and go through the same minimum sample count; among
 * those that reach it, the literal measurement remains preferred as the
 * direct one. Median — so that one kerning outlier doesn't shift the
 * correction.
 *
 * The literal path does NOT short-circuit the rest: it used to hand control
 * back at `if (literal.length > 0)` with just ONE sample, so on a real
 * document (where literal hyphens are a handful) the hundred-sample
 * derivation from shortfalls would never have run, and the hyphen width
 * would have rested on a single glyph.
 */
export function widthContext(lines: readonly LineMeasure[]): WidthContext {
  const literal = literalHyphenEms(lines);
  const derived = shortfallHyphenEms(lines);
  const literalOk = literal.length >= HYPHEN_MIN_SAMPLES;
  const derivedOk = derived.length >= HYPHEN_MIN_SAMPLES;

  if (!literalOk && !derivedOk) return FALLBACK_CONTEXT;

  const disagreement =
    literalOk && derivedOk ? Math.abs(median(literal) - median(derived)) : null;

  const [ems, source] = literalOk
    ? ([literal, "literal"] as const)
    : ([derived, "shortfall"] as const);

  return {
    hyphenEm: median(ems),
    hyphenSource: source,
    hyphenSamples: ems.length,
    hyphenDisagreementEm: disagreement,
  };
}
