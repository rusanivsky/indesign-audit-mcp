/**
 * B5.3d. RIVER detector — vertical strips of white space that the eye reads
 * as a hole in a paragraph. Pure TypeScript.
 *
 * WHAT'S MEASURED HERE, AND WHAT IT ISN'T
 * ==============================
 * The three neighboring detectors each measure ONE line: its spacing density
 * (Task 8), its length and position (Task 9), its hyphenation (Task 10). This
 * one is the only one whose subject doesn't exist on a single line at all: a
 * river is a relationship BETWEEN lines. Everything else in this file follows
 * from that, and above all a question the neighbors don't have:
 * **which lines even sit one under the other.**
 *
 * THE MAIN TRAP: `containerId` IS A STORY, NOT A FRAME AND NOT A COLUMN
 * ================================================================
 * `containerId` is built as `"story:" + s` (`src/jsx/composition.jsx:162`),
 * meaning a single story runs across hundreds of pages. You CANNOT group
 * lines by `containerId` alone and sort by `baseline`, and this isn't
 * pedantry:
 *
 * - `baseline` is a coordinate in the PAGE's coordinate system (`line.baseline`,
 *   `src/jsx/composition.jsx`), so lines on different pages carry the same
 *   values. Sorting by `baseline` within a story would scramble the entire
 *   document, and the first line of every page would become a "neighbor" of
 *   the first line of every other page;
 * - the book's main text is set to the same measure (368.504 pt,
 *   `docs/measured-facts-phase3.md`, "Effective measure"), meaning columns on
 *   different pages sit at the SAME x. So scrambled lines from different
 *   pages overlap horizontally no worse than genuine neighbors do — this
 *   would not be a rare false positive but a systematic one.
 *
 * That's why adjacency is determined separately (`adjacent`) and rests on
 * five conditions at once; each is named where it stands.
 *
 * WHAT'S TAKEN FROM THE SHARED CORRECTIONS, AND WHY
 * ====================================
 * - `isMeasurable` — mandatory, but NOT for the reason first recorded here;
 *   I'm leaving the false version named so it doesn't come back. It used to
 *   say that the book's measured ±90° frames (111 lines, all `chars[].x` the
 *   same constant) would produce "a perfect river out of nowhere."
 *   **Untrue:** identical x's mean gaps of ZERO width, and those are already
 *   discarded by `spaceGaps`'s `width > 0` filter. A mutation run confirmed
 *   this — with `!rotated` removed, the ±90° test stays green.
 *
 *   The rule's real catch is a frame at a NON-RIGHT angle: `rotated` is
 *   `rotationAngle !== 0`, not "±90°," and on such a frame the axis-aligned
 *   x's VARY, so the gaps come out nonzero and the width filter doesn't see
 *   them. All horizontal geometry there is invalid (`types.ts`, the comment
 *   on `rotated`). This is exactly the case the "a frame at an arbitrary
 *   angle is also unfit" test (30°) catches, and it's exactly the one that
 *   fails when the rule is removed. THIS book has no such frames measured —
 *   the rule protects against a class not represented in the corpus, and
 *   it's more honest to say so than to pass off ±90° as its reason.
 *
 *   A second, weaker reason: empty paragraphs (484 lines) have no glyphs at
 *   all, so they produce no gaps whatsoever.
 *
 *   Separately, about the `isMeasurable` CALL here, in `columnSegments`: for
 *   `detectRivers`'s OUTPUT it's inert, because `spaceGaps` gates on the same
 *   rule a second time — an unfit line returns an empty gap list and breaks
 *   the run just the same. The call stays for two reasons, neither about
 *   findings: it drives the `surveyRivers().judged/excluded` denominator
 *   (where the difference is visible) and narrows the type to
 *   `MeasurableLine`, whose brand the rest of the module relies on.
 * - `spaceGaps` from `calibrate.ts` — the same rule as in calibration
 *   (`spaceWidths` is now derived from it), just with coordinates. No
 *   separate "what counts as a space" rule is derived here.
 *
 * IS THERE A RIVER IN UNJUSTIFIED SETTING — TASK 11'S DECISION
 * ======================================================
 * **Yes, and unjustified paragraphs are NOT filtered out by default.**
 *
 * The temptation to filter them rests on the measured fact that unjustified
 * lines "trivially yield exactly 1.000" (50.2% of the book's lines, 2,608 out
 * of 5,193 — `docs/measured-facts-phase3.md`, "Distribution of
 * `justification`"). But that's a fact about the RATIO of space width to
 * natural width, i.e. about Task 8's subject. A river doesn't measure space
 * width — it measures the COINCIDENCE OF ITS COORDINATES across neighboring
 * lines, and coordinates in unjustified setting aren't constant — they depend
 * on word lengths. The "excluded by construction" argument doesn't transfer
 * here, and transferring it would repeat the mistake Task 9's review already
 * corrected in the opposite direction.
 *
 * THE COST OF THIS DECISION, stated honestly: in unjustified setting, every
 * space sits at its natural width (2.645 pt at 11.5 pt type,
 * `docs/measured-facts-phase3.md`), meaning the white strip is narrow, and a
 * coordinate coincidence is more often accidental than defective. That's
 * exactly why gap width feeds into the finding's STRENGTH (see `strengthOf`)
 * — narrow coincidences end up at the bottom of the ranking rather than being
 * hidden — and that's exactly why `justifiedOnly` exists for whoever fixes
 * rivers by hand: in an unjustified paragraph, inter-word spaces can't be
 * changed at all — there, the cure is rewriting. Filtering the input array
 * from OUTSIDE isn't possible — it would glue non-adjacent lines together —
 * so the option has to live here.
 */

import { type SpaceGap, spaceGaps } from "./calibrate.js";
import { findingId } from "./finding.js";
import { type MeasurableLine, isJustified, isMeasurable, median, percentile } from "./measurable.js";
import type { Finding, LineMeasure, Severity } from "./types.js";

/**
 * How many lines in a row form a river.
 *
 * **THIS IS A TYPESETTING CONVENTION (3), SHIFTED BY ONE BASED ON AN
 * ESTIMATE — not a measurement.** Saying this just as plainly as Task 10 said
 * it about its own `maxLadder`: there is NO distribution of river lengths in
 * `docs/measured-facts-phase3.md`, nobody counted it, and I can't count it
 * either — that requires a measurement pass on the open document, and this
 * task is pure TypeScript.
 *
 * WHERE 4 COMES FROM, INSTEAD OF THE CONVENTIONAL 3. The traditional
 * definition of a river is "three or more spaces lined up." The estimate
 * below says that at 3 the default FLOODS the report, and this block's
 * doctrine forbids a flooding default (Task 8 removed its own default
 * precisely because of 59.14%; Tasks 9 and 10 kept theirs precisely because
 * those stay silent in the worst case).
 *
 * THE ESTIMATE ITSELF — and why it's an estimate, not a measurement. The
 * inputs are measured: measure 368.504 pt; natural space width 2.645 pt at
 * 11.5 pt type; median ratio of a justified line 1.305, i.e. a typical gap
 * ≈3.45 pt; in the measured samples, a line has 6–11 gaps, I take 9 (all from
 * `docs/measured-facts-phase3.md`, the "Distribution" and "Mechanism check"
 * sections). Two gaps overlap when their centers are closer than
 * (w₁+w₂)/2 ≈ 3.45 pt, so the expected number of continuations of one gap on
 * the next line is ≈ 9 × 6.9 / 368.5 ≈ 0.17. A run of three lines from one
 * gap is on the order of 0.17 × 0.13 ≈ 0.02 (the second step is smaller
 * because the channel has already narrowed), and for a line with 9 gaps
 * ≈ 0.19. On **2,580 `LEFT_JUSTIFIED` lines** this is **on the order of
 * hundreds** of runs of length 3, on the order of **tens** for length 4, and
 * **single digits** for length 5.
 *
 * TWO LABELS ON THE INPUTS, so they aren't read as solid (review):
 *  - 2,580 is the line count for `LEFT_JUSTIFIED` alone; all justified lines
 *    total 2,585 (plus 5 `RIGHT_JUSTIFIED`, `docs/measured-facts-phase3.md`,
 *    "Distribution of `justification`"). The difference doesn't affect the
 *    order of magnitude of the estimate, but the number here is labeled for
 *    what it is;
 *  - "6–11 gaps per line" rests on **six** lines: five from the "Mechanism
 *    check" table (10, 9, 8, 9, 11) and one from "Distribution" (paragraph
 *    99, line 1 — 6 gaps). That's not a distribution, it's a handful of
 *    samples from two sections, and taking 9 from it is a choice, not the
 *    sample's median.
 *
 * WHAT THIS ESTIMATE DOESN'T DO: it assumes independent space positions, and
 * they aren't independent (word lengths correlate between neighboring lines
 * through the text itself). So the number could be wrong in either direction
 * and by SEVERAL TIMES OVER. It supports exactly one claim — "3 can flood the
 * report, 4 probably can't" — and does NOT determine the threshold. Anyone
 * who needs a number for THEIR OWN document should look at `surveyRivers()`:
 * it returns the raw distribution of run lengths, exactly the value I'm
 * missing. The "survey first, threshold second" order was set by Task 8.
 *
 * WHY THERE'S A DEFAULT AT ALL, despite Task 8 removing its own: the
 * signature `detectRivers(lines, opts?)` is specified by the plan as
 * OPTIONAL options, meaning Task 8's path ("the parameter is mandatory, no
 * default") is closed off by the interface. What's left is to pick the
 * safest value and say what number it is.
 */
export const DEFAULT_MIN_ROWS = 4;

/**
 * How far apart gaps may drift horizontally, in points.
 *
 * **DEFAULT 0 IS NOT A THRESHOLD — IT'S A REFUSAL TO SET ONE.** The brief
 * proposed "half the space width, 2 pt," and that number doesn't hold up
 * twice over: half the book's measured natural width is 1.32 pt, not 2
 * (2.645 / 2, `docs/measured-facts-phase3.md`), and baked into points it
 * doesn't carry over to a different type size — the same flaw for which the
 * hyphen width in `measurable.ts` is expressed as a fraction of the type
 * size rather than as 3.91 pt.
 *
 * In place of a chosen-by-feel number there is GEOMETRY here: a gap is a
 * segment `[left; right)`, and two gaps belong to the same white strip when
 * their segments INTERSECT. Intersection assumes nothing and needs no
 * constant — it's literally "a vertical line can be drawn through both
 * gaps." The run tracks a ROLLING intersection rather than comparing
 * neighbors pairwise: otherwise a river could "drift" sideways by dozens of
 * points while staying formally continuous, and would no longer be a
 * vertical strip.
 *
 * `tolerancePt` widens each segment by ±tolerance BEFORE the intersection,
 * i.e. it lets the river wander. A nonzero value is a deliberate choice made
 * by the caller; the default of 0 invents nothing and errs on the side of
 * silence.
 */
export const DEFAULT_TOLERANCE_PT = 0;

export interface RiverOptions {
  /** How many lines in a row form a river. Default — `DEFAULT_MIN_ROWS`. */
  minRows?: number;
  /**
   * How far apart gaps may drift horizontally, in points. A default of 0
   * means a strict segment intersection — see `DEFAULT_TOLERANCE_PT`.
   */
  tolerancePt?: number;
  /**
   * The minimum width of the channel itself, in points. Default 0 — no
   * filter.
   *
   * Exists because a strict intersection lets through even a HAIRLINE: a
   * channel 0.01 pt wide is formally continuous, yet reads to the eye as
   * nothing at all. There's deliberately no number here — nobody has
   * measured it; the channel-width distribution is returned by
   * `surveyRivers().channels`, and that's exactly where it should be taken
   * from.
   */
  minChannelPt?: number;
  /**
   * Judge only justified paragraphs. Default `false` — all are judged; why
   * exactly, is explained in the file header.
   */
  justifiedOnly?: boolean;
  /**
   * Count lines from master (parent) pages.
   *
   * Phase 3 debt, closed in Phase 4 (spec §8): previously `isMaster` was
   * filtered only by Task 12's caller, so this detector taken on its own
   * silently counted running heads as ordinary text. The policy is now
   * declared RIGHT HERE, where it takes effect.
   *
   * Default `false`. A master line is not judged AND DOES NOT EXTEND a
   * strip — the same conservative choice already applied to unfit lines in
   * `columnSegments`: breaking the strip is an undercount, not a fabricated
   * river. `surveyRivers` uses the same `columnSegments`, so it counts the
   * same strips the detector flags against.
   */
  includeMasters?: boolean;
}

/**
 * FINDING SEVERITY — the constant `error`, same as in Tasks 9 and 10.
 *
 * `Severity` describes four statements about a DECLARED STANDARD. There is no
 * declared standard for a river in the data: `LineMeasure` carries no
 * InDesign property that would declare one (unlike the 80/133 justification
 * bounds that feed Task 8). Everything this detector compares against —
 * `minRows` and `minChannelPt` — is declared by the CALLER, and that is
 * exactly the case of Task 8's `mode: "ratio"` and Task 10's `maxLadder`,
 * where a line past a caller-declared bound gets `error`.
 *
 * The other three values are unreachable here: `warning` needs a band, which
 * nobody has measured; `info` is unreachable because the detector SELECTS
 * rather than ranking everything indiscriminately; `unrated` is unreachable
 * because a line lacking the needed measurement produces no finding at all —
 * an unfit line is filtered out by `isMeasurable`, and a run without a
 * positive measure gets no strength and isn't emitted (see `detectRivers`).
 *
 * WHAT FOLLOWS FROM THIS FOR THE WHOLE BLOCK — see
 * `SEVERITY_VARYING_CLASSES` in `detect.ts`: after five detectors, severity
 * varies for exactly two classes out of ten, and that claim is checked there
 * by a test rather than repeated in prose a fourth time.
 */
const RIVER_SEVERITY: Severity = "error";

/** A segment along a line's horizontal axis, in points. */
interface Span {
  left: number;
  right: number;
}

/** The intersection of two segments; `null` — they don't intersect. */
function intersect(a: Span, b: Span): Span | null {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  return right > left ? { left, right } : null;
}

/** A gap, widened by the tolerance on both sides. */
function dilate(gap: SpaceGap, tolerance: number): Span {
  return { left: gap.left - tolerance, right: gap.right + tolerance };
}

/**
 * Lines sit one under the other. Five conditions, each ruling out its own
 * class of impostor:
 *
 * 1. **the same story** — otherwise a river would stitch the main text
 *    together with a footnote;
 * 2. **the same page** — the main condition; `containerId` runs across the
 *    entire document, and columns on different pages sit at the same x (see
 *    the file header);
 * 3. **the previous line isn't the last one in its frame** — a frame seam
 *    breaks the strip even within a page: two frames on the same page are
 *    separated by either an indent or another column. The flags are verified
 *    by measurement (620 frames, exactly one first and one last line in each
 *    — `docs/measured-facts-phase3.md`);
 * 4. **`baseline` increases** — y grows downward in InDesign, so a decrease
 *    means a TRANSITION INTO THE NEXT COLUMN of a multi-column frame
 *    (`usablePerColumn` in `src/jsx/composition.jsx` shows such frames are
 *    accounted for), or the input array isn't in document order. Either way,
 *    the lines aren't adjacent;
 * 5. **address adjacency** — the same paragraph with the next line number, or
 *    the NEXT paragraph starting at its line zero. This is the same caution
 *    as in Task 10's `continuationOf`: adjacency in the ARRAY is not
 *    adjacency on the page, and the detector has no right to rely on a
 *    filtering method it doesn't control. `paragraphIndex` is compared as
 *    "greater," not "greater by exactly one": a paragraph with no lines at
 *    all is skipped by the measurement layer (`paraLines.length === 0` →
 *    `continue`), so the numbering can have gaps.
 *
 * WHAT'S MISSING HERE, named rather than forgotten: a LARGE VERTICAL GAP
 * between paragraphs (`spaceBefore`/`spaceAfter`) breaks the strip to the
 * eye, but `LineMeasure` doesn't carry leading, and deriving it from the
 * `baseline` difference would mean introducing yet another unsupported
 * threshold. So a river can cross a paragraph break. This is an undercount in
 * the direction of an EXTRA finding, and it's visible in the explanation
 * (line addresses).
 */
function adjacent(prev: MeasurableLine, next: MeasurableLine): boolean {
  if (prev.containerId !== next.containerId) return false;
  if (prev.page !== next.page) return false;
  if (prev.isLastInFrame) return false;
  if (!(next.baseline > prev.baseline)) return false;
  const sameParagraph =
    next.paragraphIndex === prev.paragraphIndex &&
    next.lineInParagraph === prev.lineInParagraph + 1;
  const nextParagraph = next.paragraphIndex > prev.paragraphIndex && next.lineInParagraph === 0;
  return sameParagraph || nextParagraph;
}

/**
 * A strip of lines that truly sit one under the other. The split runs IN THE
 * ORDER OF THE INPUT ARRAY (which is document order), not by sorting on
 * `baseline`: sorting by a coordinate that repeats on every page is exactly
 * the main trap described in the file header.
 */
function columnSegments(
  lines: readonly LineMeasure[],
  justifiedOnly: boolean,
  includeMasters: boolean,
): MeasurableLine[][] {
  const segments: MeasurableLine[][] = [];
  let current: MeasurableLine[] = [];

  for (const line of lines) {
    const usable =
      (includeMasters || !line.isMaster) && isMeasurable(line) && (!justifiedOnly || isJustified(line));
    if (!usable) {
      /* An unfit line is not judged AND DOES NOT EXTEND a strip — the same
       * conservative choice as in Task 10: breaking the run gives an
       * undercount, not a fabricated defect. */
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    const prev = current[current.length - 1];
    if (prev !== undefined && !adjacent(prev, line)) {
      segments.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** A found run of gaps stacked one under the other. */
interface RiverRun {
  /** The run's lines, top to bottom. */
  lines: MeasurableLine[];
  /** The gaps taken on each of these lines. */
  gaps: SpaceGap[];
  /** The rolling intersection — the white channel itself, tolerance included. */
  channel: Span;
}

/**
 * All runs of length at least `minRows` in one strip.
 *
 * GREEDY, and here's exactly how: (a) at each step, the gap chosen is the one
 * that gives the WIDEST intersection with the current channel — i.e. the run
 * holds on to the THICKEST strip, not the longest one; on TIED intersections
 * the LEFTMOST one wins (strict comparison, `>`), and this isn't cosmetic —
 * the starting gap is exactly what sets `channel.left`, i.e. the tail of
 * `Finding.id` that Tasks 13–14 will use to anchor their fixes; (b) a gap
 * already consumed into an emitted run no longer counts as a CONTINUATION of
 * someone else's run.
 *
 * The second rule removes sub-runs: without it, a five-line river would also
 * emit its own tails from lines 2–5 and 3–5 as separate findings (this is
 * exactly what the brief's algorithm does — its outer loop starts from every
 * line, and `break` only caps the count per starting line).
 *
 * WHAT'S DELIBERATELY MISSING HERE: a `used` check at the START of a run.
 * It's been removed because no test kept it, and the behavior without it is
 * more correct — but the reason is NOT the one first written down here, and
 * the false version needs to be named so it doesn't come back. It used to say
 * that a gap already consumed inside an emitted run "won't continue anywhere
 * anyway, since everything below it is taken." **That's untrue:** `used`
 * flags individual GAPS, not lines, so lines further down still have their
 * OTHER gaps free, and starting from the middle of a run can reach all the
 * way to the end of the strip. Verified by a fixture (the test "a gap FROM
 * THE MIDDLE of an emitted run can start its own river"): lines 0–1 with a
 * gap of [100;110), lines 2–3 with [100;104) and [106;110), lines 4–5 with
 * [106;110) — the second river starts at line 1, i.e. from the MIDDLE of the
 * first one.
 *
 * THE CONSEQUENCE that follows from this and wasn't named until now: two
 * runs can share at most ONE gap — their common start (everything further is
 * filtered out by the `used` check in the continuation). So one gap can enter
 * two medians and two strengths. This is accepted deliberately: a river
 * branching off another genuinely passes through the same white gap, and
 * there's no basis for discarding it from one of the two strips.
 *
 * WHAT GREEDINESS DOES NOT GUARANTEE — and this is EXACTLY what an earlier
 * revision of this comment falsely promised the opposite of ("any run that
 * could be extended upward has already been found"). Untrue: a tie-break on
 * equal intersections can hand the upper gap to a NEIGHBORING branch, and
 * then a strip that actually starts higher up will be emitted shorter and
 * from a different line. In the fixture above, the channel [106;110) sits
 * inside line 0's gap [100;110), meaning the true strip has 6 lines starting
 * at line 0, while what's emitted is 5 lines starting at line 1. So both
 * `measured` and the line address can UNDERSTATE. Likewise, the longest run
 * isn't guaranteed when a branch with a narrower intersection runs on
 * further. There is deliberately no full search across branches here — the
 * cost is exponential, the payoff unmeasured, and the error runs toward
 * undercounting.
 */
function riverRuns(
  segment: readonly MeasurableLine[],
  tolerance: number,
  minRows: number,
): RiverRun[] {
  const gapsPerLine = segment.map((l) => spaceGaps(l));
  const used = new Set<string>();
  const runs: RiverRun[] = [];

  for (let i = 0; i < segment.length; i++) {
    for (let j = 0; j < gapsPerLine[i]!.length; j++) {
      let channel = dilate(gapsPerLine[i]![j]!, tolerance);
      const picked: [number, number][] = [[i, j]];

      for (let k = i + 1; k < segment.length; k++) {
        let bestIndex = -1;
        let bestSpan: Span | null = null;
        for (let m = 0; m < gapsPerLine[k]!.length; m++) {
          if (used.has(`${k}:${m}`)) continue;
          const span = intersect(channel, dilate(gapsPerLine[k]![m]!, tolerance));
          if (span === null) continue;
          if (bestSpan === null || span.right - span.left > bestSpan.right - bestSpan.left) {
            bestSpan = span;
            bestIndex = m;
          }
        }
        if (bestSpan === null) break;
        channel = bestSpan;
        picked.push([k, bestIndex]);
      }

      if (picked.length < minRows) continue;
      for (const [k, m] of picked) used.add(`${k}:${m}`);
      /*
       * ШИРИНА КАНАЛУ РАХУЄТЬСЯ ПО НЕРОЗШИРЕНИХ ПРОГАЛИНАХ.
       *
       * `channel` вище зібрано з `dilate(gap, tolerance)`, тобто це смуга
       * ДОПУСКУ, у якій прогалини визнано «одна під одною», а не біла смуга,
       * що її бачить око. Доти саме вона й потрапляла в `channelPt`, у текст
       * знахідки й у `surveyRivers().channels` — роздута рівно на
       * `2 × tolerance`.
       *
       * Наслідок подвійний. По-перше, `minChannelPt` не міг відсіяти нічого
       * вужчого за `2 × tolerance`: при `riverTolerancePt: 2` і
       * `riverMinChannelPt: 2` чотири прогалини по 0,01 pt давали
       * `channelPt = 4,01` і проходили фільтр, написаний саме проти
       * волосяних. По-друге, оператора відсилали шукати «смугу завширшки
       * 4,01 pt», якої на сторінці немає.
       *
       * Перетин САМИХ прогалин — те, що спільне для всіх рядків насправді.
       * Він може виявитися порожнім (прогалини лише перекриваються допуском,
       * не самі), і тоді ширина нульова: це чесний нуль, а не «нема даних».
       */
      let real: Span | null = gapsPerLine[picked[0]![0]]![picked[0]![1]]!;
      for (const [k, m] of picked.slice(1)) {
        real = real === null ? null : intersect(real, gapsPerLine[k]![m]!);
      }
      runs.push({
        lines: picked.map(([k]) => segment[k]!),
        gaps: picked.map(([k, m]) => gapsPerLine[k]![m]!),
        channel: real ?? { left: channel.left, right: channel.left },
      });
    }
  }
  return runs;
}

/**
 * FINDING STRENGTH: `lines × median gap width / measure`.
 *
 * Reads as "this many measure-shares of white space this river carries" —
 * the strip's area, normalized by column width. It grows both with the
 * river's length and with its thickness, and those are exactly the two
 * things that determine whether the eye sees a hole.
 *
 * WHY NORMALIZED BY THE MEASURE, rather than left in points: for exactly the
 * reason Task 8 gave for `airFraction` — "a physical quantity normalized by
 * the measure, and therefore comparable across type sizes, styles, and
 * columns of different widths." The book has **24 different `columnWidth`
 * values** (`docs/measured-facts-phase3.md`, "Effective measure"), so an
 * un-normalized width would be comparing different columns.
 *
 * WHY THE MEDIAN GAP WIDTH, rather than the width of the channel itself (the
 * rolling intersection), which is also at hand: the channel depends on
 * `tolerancePt`, i.e. on a CALLER parameter. Task 12 slices the document into
 * batches of pages; two batches run with different tolerances would produce
 * incommensurable strengths that would look commensurable. This is the same
 * argument by which Task 10 refused to normalize ladder length by the
 * threshold. The median gap width doesn't depend on the tolerance at all.
 * Channel width remains in the explanation and in
 * `surveyRivers().channels` — nothing there is combined with it.
 *
 * WHY THIS IS FLAWED, the trade-off named: a short, thick river can outrank a
 * long, thin one (4 lines at 12 pt give 0.130 at a 368.5 measure; 6 lines at
 * 3 pt give 0.049). I'm making this trade deliberately: a thin coincidence at
 * the natural space width is exactly the most likely FALSE POSITIVE for this
 * detector (see the file header on unjustified setting), so weighting by
 * width is, at the same time, a defense against it.
 */
function strengthOf(run: RiverRun, columnWidth: number): number {
  return (run.lines.length * median(run.gaps.map((g) => g.width))) / columnWidth;
}

/**
 * The run's measure: the median of its lines' measures.
 *
 * A CONVENTION, NOT A MEASUREMENT: a run can cross paragraphs with different
 * indents (`tests/unit/detect-rivers.test.ts`, "the measure is also a MEDIAN
 * here, not the first line's measure"), so it has no SINGLE true measure —
 * the median is simply the most outlier-resistant compromise among the
 * measures the run actually crossed.
 */
function runColumnWidth(run: RiverRun): number {
  return median(run.lines.map((l) => l.columnWidth));
}

/** The number for the explanation. */
function pt(x: number): string {
  return x.toFixed(2);
}

/**
 * Flags rivers — vertical strips of white space across neighboring lines.
 *
 * It does not flag — and does not declare clean — lines unfit for
 * measurement, and, with `justifiedOnly`, unjustified ones as well: those
 * have their own tallies in `surveyRivers`.
 *
 * A finding is emitted on the FIRST line of the run (like a ladder in Task
 * 10) and returned in descending order of strength; ties broken by key, so
 * the order is reproducible across runs. There's only one class here, so
 * there's nothing to sort by class.
 */
export function detectRivers(lines: readonly LineMeasure[], opts: RiverOptions = {}): Finding[] {
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  if (!Number.isInteger(minRows) || minRows < 2) {
    throw new Error(
      `detectRivers: minRows must be an integer ≥ 2, got ${minRows}. ` +
        "A river is a relationship BETWEEN lines, so it's undefined on a single line, " +
        "and a fractional number makes no sense for counting lines — see surveyRivers().",
    );
  }
  const tolerance = opts.tolerancePt ?? DEFAULT_TOLERANCE_PT;
  if (!(tolerance >= 0)) {
    throw new Error(
      `detectRivers: tolerancePt must be ≥ 0, got ${tolerance}. ` +
        "A negative tolerance would require gaps to overlap WITH MARGIN, " +
        "silently narrowing the very thing being measured.",
    );
  }
  const minChannel = opts.minChannelPt ?? 0;
  const out: Finding[] = [];

  for (const segment of columnSegments(lines, opts.justifiedOnly ?? false, opts.includeMasters ?? false)) {
    for (const run of riverRuns(segment, tolerance, minRows)) {
      const channelPt = run.channel.right - run.channel.left;
      if (channelPt < minChannel) continue;

      /* Without a positive measure, no strength exists, and `Finding.strength`
       * must be a number. It can't be fabricated — there is simply no finding
       * (the same choice Task 9 made for unmeasured fill). */
      const columnWidth = runColumnWidth(run);
      if (!(columnWidth > 0)) continue;

      const start = run.lines[0]!;
      const rows = run.lines.length;
      const gapMedian = median(run.gaps.map((g) => g.width));
      /* The position is part of the key: two rivers can start on ONE SAME line
       * at different spots, and without it they would merge into a single
       * finding. Two decimal places, not rounding to a whole point: gaps can be
       * narrower than a point, and neighboring channels on the same line could
       * differ by less than 1. */
      out.push({
        id: `${findingId(start, "river")}:${run.channel.left.toFixed(2)}`,
        defect: "river",
        severity: RIVER_SEVERITY,
        page: start.page,
        containerId: start.containerId,
        paragraphIndex: start.paragraphIndex,
        lineInParagraph: start.lineInParagraph,
        lineText: start.text,
        measured: rows,
        strength: strengthOf(run, columnWidth),
        detail:
          `Spaces on ${rows} adjacent lines lined up into a vertical band, ` +
          `width ${pt(channelPt)} pt (median gap ${pt(gapMedian)} pt ` +
          `at a measure of ${pt(columnWidth)} pt). The band starts at this line ` +
          `and runs to line ${run.lines[rows - 1]!.lineInParagraph} of paragraph ` +
          `${run.lines[rows - 1]!.paragraphIndex}.`,
      });
    }
  }

  out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** The distribution of rivers across the range — input for a human choosing the thresholds. */
export interface RiverSurvey {
  /** The detector's denominator: lines eligible for measurement (accounting for `justifiedOnly`). */
  judged: number;
  /** How many continuous "line under line" strips resulted. */
  segments: number;
  /**
   * The lengths of ALL runs from two lines up, ascending. Raw, not
   * aggregated: Task 12 slices the document into batches of pages, and
   * averaging batch percentiles isn't valid — they need to be computed on the
   * merged sample.
   *
   * This is the very quantity missing for deriving `minRows`: there is no
   * river-length distribution in `docs/measured-facts-phase3.md`.
   */
  runs: number[];
  /** Percentiles by nearest rank; NaN on an empty sample, not 0. */
  percentiles: { p50: number; p75: number; p95: number; max: number };
  /** The channel widths of the same runs, in points, ascending — for `minChannelPt`. */
  channels: number[];
  /**
   * Outside the denominator by construction — these are NOT "clean" lines.
   *
   * `master` was added by Task 10, Phase 4, together with
   * `RiverOptions.includeMasters`: until then, master-page lines were
   * absorbed into `notMeasurable`/`judged` with no tally of their own, and
   * the survey would have counted a different denominator than the one the
   * detector now flags against.
   */
  excluded: { notMeasurable: number; notJustified: number; master: number };
}

/**
 * Measures, but flags nothing. Exists because `minRows` is a convention
 * shifted by an estimate, and `minChannelPt` has no number at all: before
 * trusting the thresholds, you need to see the distribution on YOUR OWN
 * document. The "survey first, threshold second" order was set by Task 8.
 *
 * The geometry here is the same as in the detector, and that's exactly why
 * both functions call the same `columnSegments` and the same `riverRuns`:
 * two copies of this sequence would have diverged, and the survey would
 * start counting different runs than the ones the detector flags against.
 * The threshold is taken at the smallest possible value (2 lines), so that
 * what the default discards is also visible.
 */
export function surveyRivers(lines: readonly LineMeasure[], opts: RiverOptions = {}): RiverSurvey {
  const tolerance = opts.tolerancePt ?? DEFAULT_TOLERANCE_PT;
  const justifiedOnly = opts.justifiedOnly ?? false;
  const includeMasters = opts.includeMasters ?? false;

  const excluded = { notMeasurable: 0, notJustified: 0, master: 0 };
  let judged = 0;
  for (const line of lines) {
    if (line.isMaster && !includeMasters) {
      excluded.master++;
      continue;
    }
    if (!isMeasurable(line)) excluded.notMeasurable++;
    else if (justifiedOnly && !isJustified(line)) excluded.notJustified++;
    else judged++;
  }

  const segments = columnSegments(lines, justifiedOnly, includeMasters);
  const runs: number[] = [];
  const channels: number[] = [];
  for (const segment of segments) {
    for (const run of riverRuns(segment, tolerance, 2)) {
      runs.push(run.lines.length);
      channels.push(run.channel.right - run.channel.left);
    }
  }
  runs.sort((a, b) => a - b);
  channels.sort((a, b) => a - b);

  return {
    judged,
    segments: segments.length,
    runs,
    percentiles: {
      p50: percentile(runs, 0.5),
      p75: percentile(runs, 0.75),
      p95: percentile(runs, 0.95),
      max: runs.length === 0 ? NaN : runs[runs.length - 1]!,
    },
    channels,
    excluded,
  };
}
