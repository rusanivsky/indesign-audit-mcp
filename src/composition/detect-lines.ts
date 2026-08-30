/**
 * B5.3b. Line POSITION defect detector: orphans, widows, short final lines.
 * Pure TypeScript.
 *
 * This module's defects differ from Task 8's defects in WHAT exactly is wrong
 * with them: there, a line was SET incorrectly (the compositor exhausted its
 * freedom in the spacing); here, a line sits where it shouldn't, or is nearly
 * empty. Everything else follows from that — different strength, different
 * severity, different denominator.
 *
 * DEFINITIONS (fixed in the Task 9 briefing and nowhere else)
 * =========================================================
 * - **orphan** — a paragraph's first line is the last line of the FRAME, the paragraph has ≥2 lines;
 * - **widow** — a paragraph's last line is the first line of the FRAME, the paragraph has ≥2 lines;
 * - **short final line** — the last line of a paragraph with ≥2 lines that takes up less
 *   than `shortLastLineFraction` of the measure OR consists of a single word shorter than
 *   `minWordChars` characters.
 *
 * The boundary is the FRAME's, not the page's: `isFirstInFrame`/`isLastInFrame` were checked
 * by measurement (620 frames, exactly one first and one last line in each —
 * docs/measured-facts-phase3.md), and **at least 32 of the book's paragraphs sit across
 * two frames at once**, meaning the population this detector exists for isn't empty.
 * "At least" is exact here: the measurement counted paragraphs whose lines sit on different
 * PAGES (32); paragraphs split between FRAMES are no fewer — two frames on
 * the same page didn't make it into that count.
 *
 * SINGLE-LINE PARAGRAPHS ARE EXCLUDED EXPLICITLY — BY DEFINITION, NOT BY FRACTION
 * ==================================================================
 * A single-line paragraph can be neither a widow nor an orphan by definition: its
 * one line is both first and last at once, so there's nothing to "tear away from the rest."
 * Its "final line" is the whole paragraph (a heading, a line of dialogue, «Так.»),
 * meaning the quantity `shortLastLineFraction` measures, for it, denotes not
 * a defect but the paragraph's own length. That's why `paragraphLineCount < 2` is filtered out
 * FIRST after fitness, and has its own counter in `surveyLines`, rather than sinking
 * into "clean."
 *
 * THERE IS DELIBERATELY NO NUMBER HERE. How many single-line paragraphs are in the book, I haven't measured;
 * the only reason to be here is the definition, and that's enough. (The first draft
 * called it "1,946 of 2,981," and that was a made-up number: `docs/measured-facts-phase3.md`
 * measures **415 single-line paragraphs**, and 2,981 is the total paragraph count
 * from `src/jsx/composition.jsx`. Found by Task 9's review.)
 *
 * WHAT'S TAKEN FROM THE SHARED CORRECTIONS (`measurable.ts`) AND WHY
 * =====================================================
 * - `isMeasurable` — 595 of 5,193 lines (11.5%) are unfit. For THIS detector
 *   they're especially dangerous: a line of an empty paragraph has the FULL `columnWidth`
 *   at its own width of 2.3–7.6 pt, meaning a fill of ≈1–2% — it looks like
 *   the crudest possible "short final line" in the book, and there are 484 such lines. A line
 *   of a rotated frame has `right − left === 0`, meaning a fill of 0.
 * - `effectiveWidth` — the width to the right edge of the last non-whitespace glyph.
 *   A trailing space legitimately overhangs the measure (13 lines of the book, up to 4.599 pt);
 *   comparing against the raw `right` would inflate the fill precisely on final lines,
 *   where a trailing space is most likely.
 * - The tolerance for a drawn hyphen is deliberately not used here: all widths in this
 *   module are measured on the FINAL lines of paragraphs, and the measurement layer can never mark
 *   such a line as hyphenated at all — `endsWithHyphen` is computed as
 *   `(L < paraLines.length - 1) && …` (`src/jsx/composition.jsx`), meaning the final
 *   line of a paragraph gets `false` by construction. So `effectiveWidth` is called
 *   with an ordinary context, and no number from the hyphen calibration enters here.
 *
 * JUSTIFICATION DOESN'T FILTER (a deliberate difference from Task 8)
 * =======================================================
 * `detectSpacing` discards non-justified paragraphs, because for them the notion of a
 * "stretched space" isn't defined. Here it's the opposite: a short final line in a ragged
 * (`LEFT_ALIGN`) paragraph is the same defect as in a justified one, because what's measured
 * is the line's LENGTH, not the compositor's freedom. Non-justified lines make up
 * **50.2%** of the book (2,608 of 5,193: `LEFT_ALIGN` 2,182, `CENTER_ALIGN` 379,
 * `RIGHT_ALIGN` 47); if they dropped out, the detector wouldn't see half the corpus.
 * (In the facts doc the summary sentence said "42%" — the share of `LEFT_ALIGN` alone,
 * contradicting its own distribution table; fixed by Task 9's review.)
 *
 * The cost of this decision is named here because it isn't measured: in a CENTERED paragraph
 * (379 lines of the book `CENTER_ALIGN`, 47 `RIGHT_ALIGN`), a short final line
 * may be by design, not a defect. I chose not to exclude them blindly — that would have been
 * an unmeasured assumption about the layout — but `surveyLines` returns the raw
 * fills, so Task 12 can look at the distribution before trusting the fraction.
 */

import { findingId } from "./finding.js";
import { effectiveWidth, isMeasurable, isParagraphFinal, percentile } from "./measurable.js";
import type { Finding, LineMeasure, Severity } from "./types.js";

/**
 * The fraction of the measure below which a final line is considered short.
 *
 * THIS IS A CONVENTION, CHECKED ON A SKEWED SAMPLE, NOT A DERIVED NUMBER. I'm
 * phrasing it the same way as `DEFAULT_MIN_WORD_CHARS`, because it's the same kind of claim:
 * 0.15 is taken from the briefing (the typesetting convention "a final line should be no shorter
 * than ⅐–⅕ of the measure"), and the measurement was only used to make sure it doesn't blow up.
 *
 * WHAT WAS ACTUALLY CHECKED. The effective-measure probe (docs/measured-facts-phase3.md,
 * "Evidence for ε") gives the gap "measure − line width" on 129 final lines at a
 * measure of 368.504 pt. In fill terms that's: p05 of the gap 7.771 → 97.9%; p50 158.045 →
 * 57.1%; max 297.723 → **19.2%**. In other words, on this sample the 0.15 threshold flags
 * not a single line.
 *
 * WHY THIS ISN'T A DERIVATION — THREE SAMPLE SKEWS, THE FIRST DECISIVE:
 *
 * 1. **Single-word final lines are excluded BY CONSTRUCTION.** The probe collects the widths
 *    of inter-word spaces and does `if (ws.length === 0) continue;`
 *    (`scripts/probe-calibration-measure.jsx:141-145`), meaning a line with no
 *    space at all never enters the sample. And that's exactly the population
 *    both thresholds in this module exist for. "Flags zero" is largely an
 *    artifact of how the sample was drawn.
 * 2. **The sample is the first 400 paragraphs of the LARGEST story**, not the document.
 * 3. **The sample's denominator isn't uniform.** The probe subtracts `firstLineIndent`
 *    for a SINGLE-LINE paragraph (measure 352.517 instead of 368.504). If
 *    the emptiest line in the sample is from such a paragraph, its real fill
 *    is 15.5%, not 19.2%, and the margin over 0.15 drops from 4.2 pp to 0.5 pp.
 *    This doesn't affect the detector's population (it doesn't judge single-line paragraphs, and
 *    a multi-line paragraph's final line carries no paragraph indent) — which is exactly why
 *    the right way to refine the number is to first narrow
 *    the sample to multi-line paragraphs, and that requires a fresh probe run.
 *
 * WHY THE DEFAULT EXISTS AT ALL — unlike Task 8. Not because the number is
 * measured, but because the error direction is opposite: Task 8's rule flagged
 * 59.14% of justified lines, meaning a default would have flooded the report; here the worst
 * thing 0.15 does is stay silent. A default that can't flood the report is safe;
 * a default that flags the majority is not. The lower bound isn't groundless either:
 * the book's paragraph indent is 15.99 pt = 4.3% of the measure, and a final line shorter than
 * the indent is a defect in any style manual; 0.15 is roughly three indents.
 *
 * Whoever needs a sharper threshold should look at `surveyLines()` on THEIR OWN document and
 * name their own number. It's the same order — "survey first, then threshold" — that
 * Task 8 established, and here it's the only path to a sharper value.
 */
export const DEFAULT_SHORT_LAST_LINE_FRACTION = 0.15;

/**
 * The length of a final line's single word below which it's a defect.
 *
 * UNLIKE THE PREVIOUS ONE — THIS IS A CONVENTION, NOT A MEASUREMENT, and it should be
 * read that way. There is no number in the facts about single-word final lines: nobody
 * counted them. 4 is a standard typesetting rule ("don't leave a word
 * shorter than 4–5 letters at the end of a paragraph"), taken from the briefing unchanged.
 *
 * Why this is acceptable despite the lack of measurement: the rule can only fire on a
 * final line that consists of EXACTLY one word — that's a rare and
 * structurally recognizable event, not a threshold on a continuous distribution. `surveyLines`
 * returns `singleWordLengths`, so how many such lines exist in a given document, and
 * how long they are, is visible before the number is even chosen.
 */
export const DEFAULT_MIN_WORD_CHARS = 4;

export interface LineOptions {
  /** The fraction of column width below which a final line is considered short. */
  shortLastLineFraction?: number;
  /** The length of a final line's single word below which it's a defect. */
  minWordChars?: number;
  /**
   * Count lines on parent (master) pages.
   *
   * Phase 3 debt, closed in Phase 4 (spec §8): previously `isMaster` was filtered
   * only by Task 12's handler, so a standalone detector silently counted
   * running heads as ordinary text. The policy is now declared HERE, where it takes effect.
   *
   * Default `false`: a running head's first or last line on a master page
   * is neither a widow nor an orphan in this detector's sense — a master page
   * has no "next frame" to compare a tear-away against.
   */
  includeMasters?: boolean;
}

/**
 * Why a line is out of this detector's scope — or that it's in scope.
 *
 * A discriminated union, not a boolean: "unfit for measurement" and "single-line paragraph" are
 * different things, and neither one is "clean." Exported so Task 12 doesn't re-derive
 * the denominator and drift from the detector, the way Task 8's experience
 * required (`spacingVerdict`).
 */
export type LineVerdict = { kind: "judged" } | { kind: "not-measurable" } | { kind: "single-line" };

/** The ONE place where it's decided whether a line is in scope for this detector at all. */
export function lineVerdict(line: LineMeasure): LineVerdict {
  /* 595 of 5,193: rotated frames (fill 0) and empty paragraphs (full measure
   * at a width of 2.3–7.6 pt). Both classes look like the crudest possible defects. */
  if (!isMeasurable(line)) return { kind: "not-measurable" };
  /* Can be neither a widow nor an orphan by definition, and its "final
   * line" is the whole paragraph. See the file header; there is deliberately no number here. */
  if (line.paragraphLineCount < 2) return { kind: "single-line" };
  return { kind: "judged" };
}

/**
 * The fraction of the measure a line takes up: `effectiveWidth / columnWidth`.
 *
 * `null` — the fill is NOT MEASURED: the line is unfit, or the measure isn't positive. Zero
 * here would be a lie ("the line is empty") — the very same "null = measured" substitution
 * this module guards against everywhere.
 *
 * The value isn't bounded to one: a line can extend past the measure (13
 * cases measured, up to 4.599 pt, all a trailing space, which `effectiveWidth` already
 * discards; there remains the possibility of a hyphen tolerance on NON-final lines).
 */
export function fillFraction(line: LineMeasure): number | null {
  if (!isMeasurable(line)) return null;
  if (!(line.columnWidth > 0)) return null;
  return effectiveWidth(line) / line.columnWidth;
}

/**
 * C0 control characters that the measurement layer returns in `text` as real
 * characters, but in `chars` as `ch: null`.
 *
 * This isn't theoretical: **the table anchor is U+0016, the footnote marker is U+0004**
 * (docs/measured-facts-phase3.md, the section on C0). Without this substitution the word «абв» with
 * a footnote marker would have length 4 and the short-word rule wouldn't
 * catch it. The range matches the measurement layer's `isPrintableChar`
 * (`charCodeAt < 32`) deliberately — two different definitions of "not a glyph" would
 * diverge otherwise.
 *
 * U+2028, U+2029 and the non-breaking space are NOT included here, because `\s` already covers them.
 */
const C0 = /[\u0000-\u001F]/g;

/**
 * A line's words. The separator is any `\s`, meaning a non-breaking space (28 in
 * the book) DOES separate: the pair «на те», joined by U+00A0, counts as two words and
 * isn't caught by the single-word rule. This is deliberate: such a tail is short and
 * gets caught by the width rule, while counting a non-breaking pair as one "word" of
 * length 5 would mean the length rule is no longer measuring a word.
 */
export function lineWords(text: string): string[] {
  return text
    .replace(C0, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * FINDING SEVERITY FOR POSITION DEFECTS — a decision, not a measurement; here it is in full.
 *
 * `Severity` describes four DIFFERENT statements about a declared standard, and this
 * enum was written for Task 8, where a standard really is declared BY THE DOCUMENT ITSELF
 * (the style's numeric justification bounds, 80/133). Position defects have no such
 * standard in the data at all: `LineMeasure` doesn't carry InDesign's Keep Options, and a
 * frame boundary isn't a number that can be exceeded by 3%.
 *
 * That's why **every finding from this detector has severity `error`**, and the other three
 * values are UNREACHABLE here. This is said out loud because that exact state of affairs is what
 * Task 8's review called the trap of "a field carrying a value that means nothing":
 *
 * - `error` — justified. The predicate is exact and binary. A line either is the first in
 *   its paragraph and the last in the frame, or it isn't; there's no in-between state, the fields
 *   `isFirstInFrame`/`isLastInFrame` are never "not measured." And the share here isn't 59%:
 *   a widow is a rare structural event, not half the book.
 * - `warning` (a line in a warning band inside the boundary) — a band is only possible
 *   where there's a continuous quantity with a threshold, meaning ONLY for the short
 *   final line. Nobody measured its width, and a made-up number here would cost
 *   exactly what Task 8 refused to pay. So there's no band, and `warning` is never
 *   emitted.
 * - `info` ("measured and within bounds") — unreachable by construction: this detector
 *   SELECTS, rather than ranking everything indiscriminately, so a finding on a clean line is never
 *   created. It has no `"rank"` mode and doesn't need one: a "widow" has no
 *   continuous quantity that could be ranked across the whole book.
 * - `unrated` ("no verdict, because the bounds aren't measured") — unreachable because a line
 *   without a measurement doesn't produce a FINDING here at all: an unfit line is filtered out by
 *   `lineVerdict`, and a line without a positive measure gets neither a widow nor a short
 *   final line (see `detectLines`). In other words, "unmeasured" is reflected by the absence of a
 *   finding, not by a severity on one.
 *
 * CONSEQUENCE FOR TASK 12: sorting or filtering this detector's findings by
 * `severity` is meaningless — it's constant. `strength` carries the order.
 */
const POSITION_SEVERITY: Severity = "error";

/**
 * REJECTION STRENGTH. There are TWO of them here, and they measure different things — that's
 * the main thing to know about this module.
 *
 * `Finding.strength` is, by contract, comparable ONLY WITHIN ONE DEFECT
 * CLASS. The module takes that permission literally:
 *
 * - **widow and short final line — LINE EMPTINESS, `1 − fill`.** Physical,
 *   normalized by the measure, so it's comparable across different point sizes and column widths.
 *   Reads as "this much percent of the line is empty." For both classes this IS
 *   the defect itself: a two-word widow at the top of a page is the classic worst case,
 *   while a widow that spans the full measure barely catches the eye. These two classes are
 *   comparable to each other (one quantity), and this is the only pair in the module about which that
 *   can be said.
 *
 * - **orphan — SHARE OF THE PARAGRAPH CUT OFF BY THE SEAM, `1 / paragraphLineCount`.** Because
 *   emptiness doesn't work for an orphan, and it fails TWICE — an orphan is the FIRST
 *   line of a multi-line paragraph, meaning it's not a final line:
 *     * in a JUSTIFIED paragraph such a line reaches the measure by construction
 *       (measured: 1,403 justified lines with no hyphenation hit `columnWidth` to
 *       within ±0.001 pt), so `1 − fill` would give ≈0 to every orphan —
 *       exactly that "value that means nothing," only in strength instead of severity;
 *     * in a NON-JUSTIFIED one (and 50.2% of the book's lines are), it doesn't
 *       reach the measure, but the shortfall measures the right-edge FLAG, meaning the random length of the word
 *       that didn't fit. That's no longer zero but noise — and as a ranking key it's worse than
 *       zero, because it looks meaningful. (Task 9's review correction: the first
 *       draft named only the first side.)
 *   The paragraph's share, on the other hand, orders orphans meaningfully: an orphan in a two-line paragraph
 *   (0.5) is a paragraph torn in half, and its other half will get a widow in the
 *   same pass; an orphan in a twenty-line paragraph (0.05) is a lonely
 *   line at the bottom, followed by the whole rest of the paragraph.
 *
 * WHAT ISN'T HERE: a common scale across all three classes. It doesn't exist, and Task 11
 * owns that question separately. That's exactly why `detectLines` doesn't mix classes into one
 * ranking — see the comment on the sort.
 */
function strengthOf(defect: "widow" | "orphan" | "short-last-line", fill: number, lineCount: number): number {
  if (defect === "orphan") return 1 / lineCount;
  /* A line can legitimately extend past the measure, while strength is required to be
   * non-negative (the `Finding.strength` contract). */
  return Math.max(0, 1 - fill);
}

/** Percentage formatting for the explanation text. */
function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

/**
 * Flags lines that sit where they shouldn't, or are nearly empty.
 *
 * Does not flag — and does not declare clean — lines unfit for measurement, or lines of
 * single-line paragraphs: they have their own counters in `surveyLines`.
 *
 * RESULT ORDER: first by defect CLASS (alphabetically), within a class — by
 * descending strength, ties broken by key. Class comes first DELIBERATELY, precisely
 * because an alphabetical order of classes is meaningless: it's a refusal to assert a
 * cross-class order that nobody has measured. A mixed sort by strength alone would silently
 * equate "half the paragraph cut off" with "70% of the line is empty,"
 * i.e. two quantities in different units. Task 12 takes the `N worst` WITHIN A
 * CLASS; reconciling classes into one order is Task 11's question.
 */
export function detectLines(lines: readonly LineMeasure[], opts: LineOptions = {}): Finding[] {
  const fraction = opts.shortLastLineFraction ?? DEFAULT_SHORT_LAST_LINE_FRACTION;
  const minWord = opts.minWordChars ?? DEFAULT_MIN_WORD_CHARS;
  const out: Finding[] = [];

  const push = (
    line: LineMeasure,
    defect: "widow" | "orphan" | "short-last-line",
    measured: number,
    fill: number,
    detail: string,
  ): void => {
    out.push({
      id: findingId(line, defect),
      defect,
      severity: POSITION_SEVERITY,
      page: line.page,
      containerId: line.containerId,
      paragraphIndex: line.paragraphIndex,
      lineInParagraph: line.lineInParagraph,
      lineText: line.text,
      measured,
      strength: strengthOf(defect, fill, line.paragraphLineCount),
      detail,
    });
  };

  for (const line of lines) {
    if (line.isMaster && !opts.includeMasters) continue;
    if (lineVerdict(line).kind !== "judged") continue;

    const n = line.paragraphLineCount;
    const isFirst = line.lineInParagraph === 0;
    const isLast = isParagraphFinal(line);
    const fill = fillFraction(line);

    if (isFirst && line.isLastInFrame) {
      /* An orphan is measured by the paragraph's share, not by geometry, so it doesn't need
       * a positive measure and is emitted even where the fill isn't measured.
       * The asymmetry with a widow is deliberate: they measure DIFFERENT quantities (see `strengthOf`),
       * and each requires exactly what it's computed from. */
      const cut = 1 / n;
      push(
        line,
        "orphan",
        cut,
        fill ?? 1,
        `The paragraph's first line is left alone at the bottom of the column: the rest of the paragraph (${n - 1} of ${n} lines) ` +
          `moved to the next frame. The seam cut off ${pct(cut)} of the paragraph.`,
      );
    }

    /* Everything past this point is measured by line LENGTH, so without a measured fill there's
     * no finding: `Finding.measured` is always a number, and it can't be made up. */
    if (fill === null) continue;

    if (isLast && line.isFirstInFrame) {
      push(
        line,
        "widow",
        fill,
        fill,
        `The paragraph's last line is left alone at the top of the column, torn away from the rest ` +
          `(${n - 1} of ${n} lines that stayed in the previous frame). ` +
          `Takes up ${pct(fill)} of the measure.`,
      );
    }

    if (!isLast) continue;

    const words = lineWords(line.text);
    const only = words.length === 1 ? words[0]! : null;

    if (fill < fraction) {
      push(
        line,
        "short-last-line",
        fill,
        fill,
        `The final line takes up ${pct(fill)} of column width (threshold ${pct(fraction)}).`,
      );
    } else if (only !== null && only.length < minWord) {
      /* `else if`, not a second `if`: the defect class is the same, so two findings
       * would get the same `findingId` and Task 12 would merge them in the report. */
      push(
        line,
        "short-last-line",
        fill,
        fill,
        `The final line is a single word "${only}" of ${only.length} characters ` +
          `(threshold ${minWord}); takes up ${pct(fill)} of column width.`,
      );
    }
  }

  out.sort(
    (a, b) =>
      (a.defect < b.defect ? -1 : a.defect > b.defect ? 1 : 0) ||
      b.strength - a.strength ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return out;
}

/** Distribution of final-line fill — input for a human choosing the threshold. */
export interface LineSurvey {
  /** The detector's denominator: eligible lines of multi-line paragraphs. */
  judged: number;
  /** Of those, final lines with a MEASURED fill. */
  lastLines: number;
  /** Their measure fills, ascending. Raw — so Task 12 can pool
   *  batches of pages instead of averaging their percentiles. */
  fills: number[];
  /** Nearest-rank percentiles; NaN on an empty sample. */
  percentiles: { min: number; p05: number; p25: number; p50: number; p75: number; max: number };
  /**
   * The word lengths of those final lines that consist of EXACTLY one word.
   * Exists because `minWordChars` is a convention without a measurement: before trusting the number,
   * it's visible how many such lines exist at all and how long they are.
   */
  singleWordLengths: number[];
  /** How many lines fall under each structural defect. */
  counts: { widow: number; orphan: number };
  /**
   * Outside the denominator by construction — these are NOT "clean" lines. `noMeasure` is an
   * eligible line of a multi-line paragraph with a non-positive measure: the fill doesn't exist.
   */
  excluded: { notMeasurable: number; singleLine: number; noMeasure: number };
}

/**
 * Measures, but doesn't flag anything. Same order of work that Task 8 established:
 * survey the real distribution first, then set the threshold. Here it's needed less (the
 * threshold has a measured default), but the very fact that the default flags zero lines
 * on the measured sample means: whoever needs it more sensitive has something to look at.
 */
export function surveyLines(lines: readonly LineMeasure[]): LineSurvey {
  const fills: number[] = [];
  const singleWordLengths: number[] = [];
  const counts = { widow: 0, orphan: 0 };
  const excluded = { notMeasurable: 0, singleLine: 0, noMeasure: 0 };

  for (const line of lines) {
    switch (lineVerdict(line).kind) {
      case "not-measurable":
        excluded.notMeasurable++;
        continue;
      case "single-line":
        excluded.singleLine++;
        continue;
      case "judged":
        break;
    }

    const isFirst = line.lineInParagraph === 0;
    const isLast = isParagraphFinal(line);
    if (isFirst && line.isLastInFrame) counts.orphan++;
    if (isLast && line.isFirstInFrame) counts.widow++;

    const fill = fillFraction(line);
    if (fill === null) {
      excluded.noMeasure++;
      continue;
    }
    if (!isLast) continue;

    fills.push(fill);
    const words = lineWords(line.text);
    if (words.length === 1) singleWordLengths.push(words[0]!.length);
  }

  const judged =
    lines.length - excluded.notMeasurable - excluded.singleLine;
  fills.sort((a, b) => a - b);
  singleWordLengths.sort((a, b) => a - b);

  return {
    judged,
    lastLines: fills.length,
    fills,
    percentiles: {
      min: fills.length === 0 ? NaN : fills[0]!,
      p05: percentile(fills, 0.05),
      p25: percentile(fills, 0.25),
      p50: percentile(fills, 0.5),
      p75: percentile(fills, 0.75),
      max: fills.length === 0 ? NaN : fills[fills.length - 1]!,
    },
    singleWordLengths,
    counts,
    excluded,
  };
}
